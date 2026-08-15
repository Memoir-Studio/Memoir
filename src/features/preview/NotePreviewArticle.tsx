import {
  Fragment,
  createElement,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import ReactMarkdown, { type Components as MarkdownComponents } from "react-markdown";
import { MDXProvider, useMDXComponents } from "@mdx-js/react";
import type { MDXComponents } from "mdx/types.js";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import * as runtime from "react/jsx-runtime";
import { getGateways } from "../../gateways";
import { Tag } from "../../components/ui";
import type { NoteMeta } from "../../domain/notes";
import { decodeMediaHref, noteDirectory, resolveWorkspaceFilePath } from "../../domain/paths";
import { useI18n } from "../../i18n/react";
import { parseNote } from "../library/note-utils";
import { rehypeSourceLines } from "./source-line";
import { rehypeTaskOffsets, toggleTaskAtOffset } from "./task-list";

const MDX_IMPORT_EXPORT_DISABLED = "MDX_IMPORT_EXPORT_DISABLED";

const MermaidBlock = lazy(() => import("./MermaidBlock"));
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeSlug, rehypeKatex, rehypeTaskOffsets, rehypeSourceLines];
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
      className="my-5 rounded-lg border border-border border-l-[3px] border-l-accent bg-panel/70 px-4 py-3"
      data-callout={type}
    >
      {title && <strong className="mb-1 block text-sm">{title}</strong>}
      <div className="text-sm leading-7 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </aside>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <Tag>{children}</Tag>;
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      {title && <h3 className="mb-2 text-sm font-bold">{title}</h3>}
      <div className="text-sm text-muted [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </section>
  );
}

function Columns({ children }: { children: ReactNode }) {
  return <div className="my-4 grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 grid gap-3 [counter-reset:step] [&>*]:relative [&>*]:pl-9 [&>*]:[counter-increment:step] [&>*]:before:absolute [&>*]:before:left-0 [&>*]:before:top-0.5 [&>*]:before:grid [&>*]:before:h-6 [&>*]:before:w-6 [&>*]:before:place-items-center [&>*]:before:rounded-full [&>*]:before:bg-accent [&>*]:before:text-xs [&>*]:before:font-extrabold [&>*]:before:text-accent-contrast [&>*]:before:content-[counter(step)]">
      {children}
    </div>
  );
}

function previewComponents(
  root: string | null,
  relativePath: string | null,
  onToggleTask: ((offset: number, checked: boolean) => void) | undefined,
  labels: { toggleTask: string; loadingMermaid: string },
): MDXComponents {
  const gateway = getGateways().workspace;
  const directory = relativePath ? noteDirectory(relativePath) : "";
  return {
    Callout,
    Badge,
    Card,
    Columns,
    Steps,
    a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          if (!href) return;
          event.preventDefault();
          if (/^https?:/i.test(href)) {
            void gateway.openExternal(href);
          } else if (root) {
            void gateway.openPath(resolveWorkspaceFilePath(root, directory, decodeMediaHref(href)));
          }
        }}
      >
        {children}
      </a>
    ),
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
          <Suspense fallback={<p className="text-sm text-muted" data-mermaid-pending="">{labels.loadingMermaid}</p>}>
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
  articleRef,
  className = "memoir-preview prose prose-neutral px-9 pb-24 pt-10 dark:prose-invert",
  compileDelay = 350,
  onContentChange,
}: {
  root: string | null;
  relativePath: string | null;
  note: NoteMeta | null;
  content: string;
  articleRef?: Ref<HTMLElement | null>;
  className?: string;
  compileDelay?: number;
  onContentChange?: (content: string) => void;
}) {
  const { t } = useI18n();
  const untitled = t("editor.untitledFallback");
  const parsed = useMemo(
    () => parseNote(content, note?.fileName || untitled),
    [content, note?.fileName, untitled],
  );
  const bodyOffset = content.endsWith(parsed.body) ? content.length - parsed.body.length : 0;
  const toggleTaskLabel = t("preview.toggleTask");
  const loadingMermaidLabel = t("preview.loadingMermaid");
  const components = useMemo(
    () =>
      previewComponents(
        root,
        relativePath,
        onContentChange
          ? (taskOffset, checked) => {
              onContentChange(toggleTaskAtOffset(content, bodyOffset + taskOffset, checked));
            }
          : undefined,
        { toggleTask: toggleTaskLabel, loadingMermaid: loadingMermaidLabel },
      ),
    [
      bodyOffset,
      content,
      loadingMermaidLabel,
      onContentChange,
      relativePath,
      root,
      toggleTaskLabel,
    ],
  );
  const [mdxComponent, setMdxComponent] = useState<ComponentType<{
    components?: MDXComponents;
  }> | null>(null);
  const [error, setError] = useState("");
  const shouldCompileMdx =
    note?.extension === "mdx" && (/<[A-Z][\w.:-]*(\s|>|\/>)/.test(parsed.body) || /\{[^}\n]+\}/.test(parsed.body));
  const mdxPending = shouldCompileMdx && !mdxComponent && !error;

  useEffect(() => {
    let cancelled = false;
    if (!shouldCompileMdx) {
      setMdxComponent(null);
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      compileMdx(parsed.body)
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
  }, [compileDelay, parsed.body, shouldCompileMdx, t]);

  return (
    <article
      ref={articleRef}
      className={className}
      data-mdx-pending={mdxPending ? "" : undefined}
    >
      {error ? (
        <pre className="whitespace-pre-wrap border-danger/30 bg-danger/5 text-danger">{error}</pre>
      ) : shouldCompileMdx && mdxComponent ? (
        <MDXProvider components={components}>
          {createElement(mdxComponent, { components })}
        </MDXProvider>
      ) : (
        <ReactMarkdown
          components={components as MarkdownComponents}
          rehypePlugins={markdownRehypePlugins}
          remarkPlugins={remarkPlugins}
        >
          {parsed.body}
        </ReactMarkdown>
      )}
    </article>
  );
}
