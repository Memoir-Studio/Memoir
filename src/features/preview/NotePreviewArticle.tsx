import * as stylex from "@stylexjs/stylex";
import {
  Fragment,
  createElement,
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import ReactMarkdown, { type Components as MarkdownComponents } from "react-markdown";
import { MDXProvider, useMDXComponents } from "@mdx-js/react";
import type { MDXComponents } from "mdx/types.js";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import * as runtime from "react/jsx-runtime";
import { getGateways } from "../../gateways";
import { Tag } from "../../components/ui";
import type { NoteMeta } from "../../domain/notes";
import {
  isNoteMarkdownHref,
  resolveNoteRef,
  splitHash,
  type NoteGraphNode,
} from "../../domain/note-links";
import { decodeMediaHref, noteDirectory, resolveWorkspaceFilePath } from "../../domain/paths";
import { useNoteGraph } from "../graph/useNoteGraph";
import { LinkCard } from "./LinkCard";
import { readLinkCardProp, remarkLinkCards } from "./remark-link-cards";
import { remarkWikiLinks, wikiInnerFromHref } from "./remark-wiki-links";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { stripFrontmatter } from "../library/note-utils";
import { rehypeSourceLines } from "./source-line";
import { rehypeTaskOffsets, toggleTaskAtOffset } from "./task-list";
import { accents, colors, typography } from "../../styles/tokens.stylex";
import { LONG_NOTE_DEFER_THRESHOLD } from "../editor/editor-performance";

const MDX_IMPORT_EXPORT_DISABLED = "MDX_IMPORT_EXPORT_DISABLED";
export const MARKDOWN_PREVIEW_DELAY_MS = 200;

const MermaidBlock = lazy(() => import("./MermaidBlock"));
const remarkPlugins = [remarkGfm, remarkMath, remarkWikiLinks, remarkLinkCards];
const highlightCode: [typeof rehypeHighlight, { detect: boolean; plainText: string[] }] = [
  rehypeHighlight,
  { detect: false, plainText: ["mermaid"] },
];
const rehypePlugins = [rehypeSlug, rehypeKatex, rehypeTaskOffsets, rehypeSourceLines, highlightCode];
const markdownRehypePlugins = [rehypeRaw, ...rehypePlugins];
const mdxCache = new Map<string, ComponentType<{ components?: MDXComponents }>>();

function Callout({
  type = "note",
  title,
  children,
}: {
  type?: "note" | "tip" | "warning" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside
      data-callout={type}
      data-preview-callout=""
      {...stylex.props(styles.callout)}
    >
      {title && <strong {...stylex.props(styles.calloutTitle)}>{title}</strong>}
      <div data-preview-trim-children="" {...stylex.props(styles.calloutBody)}>{children}</div>
    </aside>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <Tag>{children}</Tag>;
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section {...stylex.props(styles.mdxCard)}>
      {title && <h3 {...stylex.props(styles.cardTitle)}>{title}</h3>}
      <div data-preview-trim-children="" {...stylex.props(styles.cardBody)}>{children}</div>
    </section>
  );
}

function Columns({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.columns)}>{children}</div>;
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <div data-preview-steps="" {...stylex.props(styles.steps)}>
      {children}
    </div>
  );
}

function previewComponents(
  root: string | null,
  relativePath: string | null,
  onToggleTask: ((offset: number, checked: boolean) => void) | undefined,
  labels: {
    toggleTask: string;
    loadingMermaid: string;
    missingWikiLink: (name: string) => string;
  },
  catalog: NoteGraphNode[],
  onOpenNote?: (path: string) => void,
): MDXComponents {
  const gateway = getGateways().workspace;
  const directory = relativePath ? noteDirectory(relativePath) : "";
  return {
    Callout,
    Badge,
    Card,
    Columns,
    Steps,
    div: ({
      className,
      children,
      node: _node,
      ...props
    }: ComponentPropsWithoutRef<"div"> & { node?: unknown }) => {
      const url = readLinkCardProp({ ...props, node: _node }, "url");
      if (url) {
        return (
          <div {...props} data-link-card-host="" {...stylex.props(styles.linkCardHost)}>
            <LinkCard
              label={readLinkCardProp({ ...props, node: _node }, "label")}
              onOpen={(href) => void gateway.openExternal(href)}
              url={url}
            />
          </div>
        );
      }
      return (
        <div {...props} className={className}>
          {children}
        </div>
      );
    },
    a: ({ href, children, className, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) => {
      const wikiInner = href ? wikiInnerFromHref(href) : null;
      const targetRef = wikiInner
        ? splitHash(wikiInner.split("|")[0] || "").path
        : href && isNoteMarkdownHref(href)
          ? splitHash(decodeMediaHref(href)).path
          : "";
      const resolved =
        targetRef && relativePath ? resolveNoteRef(targetRef, relativePath, catalog) : undefined;
      const missingWiki = Boolean(wikiInner && !resolved);
      return (
        <a
          {...props}
          className={className}
          data-wiki-link-missing={missingWiki ? "" : undefined}
          href={href}
          title={missingWiki ? labels.missingWikiLink(targetRef) : props.title}
          onClick={(event) => {
            if (!href) return;
            event.preventDefault();
            if (/^https?:/i.test(href)) {
              void gateway.openExternal(href);
              return;
            }
            if (resolved) {
              onOpenNote?.(resolved);
              return;
            }
            if (wikiInner) return;
            if (root) {
              void gateway.openPath(resolveWorkspaceFilePath(root, directory, decodeMediaHref(href)));
            }
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) => {
      if (!src || /^(https?:|data:|blob:)/i.test(src) || !root) {
        return <img {...props} alt={alt || ""} src={src} />;
      }
      return (
        <img
          {...props}
          alt={alt || ""}
          src={gateway.resolveMediaPath(
            resolveWorkspaceFilePath(root, directory, decodeMediaHref(src)),
          )}
        />
      );
    },
    input: ({ type, ...props }: ComponentPropsWithoutRef<"input">) => {
      if (type !== "checkbox") return <input {...props} type={type} />;
      return (
        <input
          {...props}
          aria-label={labels.toggleTask}
          disabled={!onToggleTask}
          onChange={(event) => {
            const taskItem = event.currentTarget.closest("[data-task-offset]");
            const offset = Number(taskItem?.getAttribute("data-task-offset"));
            if (Number.isFinite(offset)) onToggleTask?.(offset, event.currentTarget.checked);
          }}
          type="checkbox"
        />
      );
    },
    code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
      if (/language-mermaid/.test(className || "")) {
        return (
          <Suspense
            fallback={
              <p data-mermaid-pending="" {...stylex.props(styles.pending)}>
                {labels.loadingMermaid}
              </p>
            }
          >
            <MermaidBlock code={String(children).trim()} />
          </Suspense>
        );
      }
      return (
        <code {...props} className={className}>
          {children}
        </code>
      );
    },
  };
}

async function compileMdx(source: string) {
  if (/^\s*(import|export)\s/m.test(source)) {
    throw new Error(MDX_IMPORT_EXPORT_DISABLED);
  }
  const cached = mdxCache.get(source);
  if (cached) return cached;
  const { compile } = await import("@mdx-js/mdx");
  const compiled = await compile(source, {
    outputFormat: "function-body",
    providerImportSource: "@mdx-js/react",
    remarkPlugins,
    rehypePlugins,
    development: false,
  });
  const moduleFactory = new Function(String(compiled));
  const module = moduleFactory({ ...runtime, Fragment, useMDXComponents }) as {
    default: ComponentType<{ components?: MDXComponents }>;
  };
  const Content = module.default;
  if (mdxCache.size > 40) mdxCache.delete(mdxCache.keys().next().value || "");
  mdxCache.set(source, Content);
  return Content;
}

export function NotePreviewArticle({
  root,
  relativePath,
  note,
  content,
  body,
  articleRef,
  style,
  exportMode = false,
  compileDelay = 350,
  onContentChange,
}: {
  root: string | null;
  relativePath: string | null;
  note: NoteMeta | null;
  content: string;
  body?: string;
  articleRef?: Ref<HTMLElement | null>;
  style?: stylex.StyleXStyles;
  exportMode?: boolean;
  compileDelay?: number;
  onContentChange?: (content: string) => void;
}) {
  const { t } = useI18n();
  const { graph } = useNoteGraph();
  const selectNote = useAppStore((state) => state.selectNote);
  const viewMode = useAppStore((state) => state.viewMode);
  const markdownBody = useMemo(() => body ?? stripFrontmatter(content), [body, content]);
  const bodyOffset = content.endsWith(markdownBody) ? content.length - markdownBody.length : 0;
  const toggleTaskLabel = t("preview.toggleTask");
  const loadingMermaidLabel = t("preview.loadingMermaid");
  const contentRef = useRef(content);
  const bodyOffsetRef = useRef(bodyOffset);
  const skipPreviewDelayRef = useRef(false);
  contentRef.current = content;
  bodyOffsetRef.current = bodyOffset;
  const onToggleTask = useMemo(
    () =>
      onContentChange
        ? (taskOffset: number, checked: boolean) => {
            skipPreviewDelayRef.current = true;
            onContentChange(
              toggleTaskAtOffset(contentRef.current, bodyOffsetRef.current + taskOffset, checked),
            );
          }
        : undefined,
    [onContentChange],
  );
  const selectNoteRef = useRef(selectNote);
  selectNoteRef.current = selectNote;
  const components = useMemo(
    () =>
      previewComponents(
        root,
        relativePath,
        onToggleTask,
        {
          toggleTask: toggleTaskLabel,
          loadingMermaid: loadingMermaidLabel,
          missingWikiLink: (name) => t("preview.missingWikiLink", { name }),
        },
        graph.nodes,
        (path) => void selectNoteRef.current(path),
      ),
    [graph.nodes, loadingMermaidLabel, onToggleTask, relativePath, root, t, toggleTaskLabel],
  );
  const [mdxComponent, setMdxComponent] = useState<ComponentType<{
    components?: MDXComponents;
  }> | null>(null);
  const [error, setError] = useState("");
  const shouldCompileMdx =
    note?.extension === "mdx" && (/<[A-Z][\w.:-]*(\s|>|\/>)/.test(markdownBody) || /\{[^}\n]+\}/.test(markdownBody));
  const mdxPending = shouldCompileMdx && !mdxComponent && !error;
  const markdownDelay = compileDelay === 0 ? 0 : MARKDOWN_PREVIEW_DELAY_MS;
  const deferInitialMarkdown =
    !shouldCompileMdx &&
    !exportMode &&
    markdownDelay > 0 &&
    markdownBody.length >= LONG_NOTE_DEFER_THRESHOLD;
  const [previewBody, setPreviewBody] = useState(
    deferInitialMarkdown ? "" : markdownBody,
  );
  const deferredPreviewBody = useDeferredValue(previewBody);
  const markdownPending =
    !shouldCompileMdx && !deferredPreviewBody && Boolean(markdownBody);

  useEffect(() => {
    if (shouldCompileMdx) return;
    if (markdownBody === previewBody) return;
    if (skipPreviewDelayRef.current || markdownDelay === 0) {
      skipPreviewDelayRef.current = false;
      setPreviewBody(markdownBody);
      return;
    }
    const timer = window.setTimeout(() => setPreviewBody(markdownBody), markdownDelay);
    return () => window.clearTimeout(timer);
  }, [markdownBody, markdownDelay, previewBody, shouldCompileMdx]);

  useEffect(() => {
    let cancelled = false;
    if (!shouldCompileMdx) {
      setMdxComponent(null);
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      compileMdx(markdownBody)
        .then((component) => {
          if (!cancelled) {
            setMdxComponent(() => component);
            setError("");
          }
        })
        .catch((compileError: unknown) => {
          if (!cancelled) {
            const raw =
              compileError instanceof Error ? compileError.message : String(compileError);
            setError(raw === MDX_IMPORT_EXPORT_DISABLED ? t("preview.mdxImportDisabled") : raw);
          }
        });
    }, compileDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [compileDelay, markdownBody, shouldCompileMdx, t]);

  return (
    <article
      ref={articleRef}
      data-mdx-pending={mdxPending ? "" : undefined}
      data-pdf-preview={exportMode ? "" : undefined}
      data-preview-root=""
      {...stylex.props(
        styles.article,
        viewMode === "split" && styles.splitArticle,
        exportMode && styles.exportArticle,
        style,
      )}
    >
      {error ? (
        <pre {...stylex.props(styles.error)}>{error}</pre>
      ) : shouldCompileMdx && mdxComponent ? (
        <MDXProvider components={components}>
          {createElement(mdxComponent, { components })}
        </MDXProvider>
      ) : markdownPending ? (
        <p data-preview-pending="" {...stylex.props(styles.pending)}>
          {t("preview.rendering")}
        </p>
      ) : (
        <ReactMarkdown
          components={components as MarkdownComponents}
          rehypePlugins={markdownRehypePlugins}
          remarkPlugins={remarkPlugins}
        >
          {shouldCompileMdx ? markdownBody : deferredPreviewBody}
        </ReactMarkdown>
      )}
    </article>
  );
}

const styles = stylex.create({
  article: {
    width: "100%",
    maxWidth: {
      default: 760,
      [stylex.when.ancestor('[data-content-width="narrow"]')]: 590,
      [stylex.when.ancestor('[data-content-width="wide"]')]: 860,
      [stylex.when.ancestor('[data-content-width="full"]')]: "none",
    },
    marginInline: "auto",
    paddingTop: 12,
    paddingRight: 16,
    paddingBottom: 72,
    paddingLeft: 16,
    color: colors.text,
    fontFamily: {
      default: typography.uiFont,
      [stylex.when.ancestor('[data-body-font="serif"]')]: typography.serifFont,
    },
    fontSize: typography.bodySize,
    lineHeight: typography.lineHeight,
    letterSpacing: 0,
    overflowWrap: "break-word",
    userSelect: "text",
    WebkitUserSelect: "text",
  },
  splitArticle: {
    maxWidth: "none",
  },
  exportArticle: {
    maxWidth: "none",
    margin: 0,
    paddingTop: 48,
    paddingRight: 56,
    paddingBottom: 64,
    paddingLeft: 56,
    color: "#222222",
    backgroundColor: "#ffffff",
  },
  callout: {
    marginBlock: 20,
    paddingBlock: 12,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: accents.primary,
    borderRadius: 8,
    backgroundColor: `color-mix(in srgb, ${colors.panel} 70%, transparent)`,
  },
  calloutTitle: {
    display: "block",
    marginBottom: 4,
    fontSize: 14,
  },
  calloutBody: {
    fontSize: 14,
    lineHeight: "28px",
  },
  mdxCard: {
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  cardTitle: {
    marginTop: 0,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: 700,
  },
  cardBody: {
    color: colors.muted,
    fontSize: 14,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr",
      "@media (min-width: 640px)": "repeat(2, minmax(0, 1fr))",
    },
    gap: 12,
    marginBlock: 16,
  },
  steps: {
    display: "grid",
    gap: 12,
    marginBlock: 16,
    counterReset: "step",
  },
  linkCardHost: {
    maxWidth: "100%",
    marginBlock: "1.15em",
  },
  pending: {
    color: colors.muted,
    fontSize: 14,
  },
  error: {
    whiteSpace: "pre-wrap",
    color: colors.danger,
    borderColor: `color-mix(in srgb, ${colors.danger} 30%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${colors.danger} 5%, transparent)`,
  },
});
