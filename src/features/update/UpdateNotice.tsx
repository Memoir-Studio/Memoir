import * as stylex from "@stylexjs/stylex";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Dialog } from "../../components/ui";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import { accents, colors, typography } from "../../styles/tokens.stylex";

const styles = stylex.create({
  dialog: {
    maxWidth: 520,
  },
  skipButton: {
    marginRight: "auto",
  },
  notes: {
    color: `color-mix(in srgb, ${colors.text} 88%, ${colors.muted})`,
    fontFamily: typography.uiFont,
    fontSize: 13,
    lineHeight: 1.65,
    margin: "-2px -8px -4px 0",
    maxHeight: "min(22rem, 50vh)",
    overflow: "auto",
    overflowWrap: "anywhere",
    paddingRight: 12,
    scrollbarGutter: "stable",
  },
  heading: {
    color: colors.text,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.35,
    marginBottom: {
      default: "0.55em",
      ":is([data-update-notes] > :last-child)": 0,
    },
    marginLeft: 0,
    marginRight: 0,
    marginTop: {
      default: "1.35em",
      ":is([data-update-notes] > :first-child)": 0,
    },
  },
  heading1: {
    fontSize: "1.3em",
  },
  heading2: {
    borderBottomColor: `color-mix(in srgb, ${colors.border} 72%, transparent)`,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    fontSize: "1.16em",
    paddingBottom: "0.35em",
  },
  headingSmall: {
    fontSize: "1em",
  },
  block: {
    marginBottom: {
      default: "0.7em",
      ":is([data-update-notes] > :last-child)": 0,
    },
    marginLeft: 0,
    marginRight: 0,
    marginTop: {
      default: "0.7em",
      ":is([data-update-notes] > :first-child)": 0,
    },
  },
  list: {
    paddingLeft: "1.55em",
  },
  listItem: {
    marginTop: {
      default: 0,
      ":is(li + li)": "0.28em",
    },
  },
  link: {
    color: accents.primary,
    textDecorationColor: {
      default: `color-mix(in srgb, ${accents.primary} 45%, transparent)`,
      ":hover": "currentColor",
    },
    textUnderlineOffset: 3,
  },
  blockquote: {
    borderLeftColor: `color-mix(in srgb, ${colors.border} 72%, ${colors.muted})`,
    borderLeftStyle: "solid",
    borderLeftWidth: 3,
    color: colors.muted,
    paddingLeft: "0.9em",
  },
  code: {
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.panel} 88%, transparent)`,
      ":is(pre > code)": "transparent",
    },
    borderRadius: 4,
    color: colors.text,
    fontFamily: typography.monoFont,
    fontSize: "0.9em",
    padding: {
      default: "0.12em 0.35em",
      ":is(pre > code)": 0,
    },
  },
  pre: {
    backgroundColor: `color-mix(in srgb, ${colors.panel} 72%, transparent)`,
    borderColor: `color-mix(in srgb, ${colors.border} 74%, transparent)`,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    overflowX: "auto",
    padding: "10px 12px",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
  },
  tableCell: {
    borderColor: colors.border,
    borderStyle: "solid",
    borderWidth: 1,
    padding: "6px 8px",
    textAlign: "left",
  },
  tableHeading: {
    backgroundColor: `color-mix(in srgb, ${colors.panel} 72%, transparent)`,
    color: colors.text,
    fontWeight: 650,
  },
  image: {
    borderRadius: 8,
    display: "block",
    height: "auto",
    marginBottom: {
      default: "0.85em",
      ":is([data-update-notes] > :last-child)": 0,
    },
    marginLeft: "auto",
    marginRight: "auto",
    marginTop: {
      default: "0.85em",
      ":is([data-update-notes] > :first-child)": 0,
    },
    maxWidth: "100%",
  },
  rule: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopColor: colors.border,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    marginBottom: {
      default: "1.1em",
      ":is([data-update-notes] > :last-child)": 0,
    },
    marginLeft: 0,
    marginRight: 0,
    marginTop: {
      default: "1.1em",
      ":is([data-update-notes] > :first-child)": 0,
    },
  },
  checkbox: {
    margin: "0 0.45em 0 0",
  },
});

function ReleaseNotesLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href && /^https?:\/\//i.test(href)) {
          void getGateways().system.openExternal(href);
        }
      }}
      {...stylex.props(styles.link)}
    >
      {children}
    </a>
  );
}

const releaseNotesComponents: Components = {
  a: ReleaseNotesLink,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      {...props}
      {...stylex.props(styles.block, styles.blockquote)}
    />
  ),
  code: ({ node: _node, ...props }) => (
    <code {...props} {...stylex.props(styles.code)} />
  ),
  h1: ({ node: _node, ...props }) => (
    <h1 {...props} {...stylex.props(styles.heading, styles.heading1)} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 {...props} {...stylex.props(styles.heading, styles.heading2)} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 {...props} {...stylex.props(styles.heading, styles.headingSmall)} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 {...props} {...stylex.props(styles.heading, styles.headingSmall)} />
  ),
  hr: ({ node: _node, ...props }) => (
    <hr {...props} {...stylex.props(styles.rule)} />
  ),
  img: ({ node: _node, ...props }) => (
    <img {...props} {...stylex.props(styles.image)} />
  ),
  input: ({ node: _node, ...props }) => (
    <input {...props} {...stylex.props(styles.checkbox)} />
  ),
  li: ({ node: _node, ...props }) => (
    <li {...props} {...stylex.props(styles.listItem)} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol {...props} {...stylex.props(styles.block, styles.list)} />
  ),
  p: ({ node: _node, ...props }) => (
    <p {...props} {...stylex.props(styles.block)} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre {...props} {...stylex.props(styles.block, styles.pre)} />
  ),
  table: ({ node: _node, ...props }) => (
    <table {...props} {...stylex.props(styles.block, styles.table)} />
  ),
  td: ({ node: _node, ...props }) => (
    <td {...props} {...stylex.props(styles.tableCell)} />
  ),
  th: ({ node: _node, ...props }) => (
    <th
      {...props}
      {...stylex.props(styles.tableCell, styles.tableHeading)}
    />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul {...props} {...stylex.props(styles.block, styles.list)} />
  ),
};

export function UpdateNotice({
  open,
  latestVersion,
  releaseNotes,
  onClose,
  onSkip,
  onDownload,
}: {
  open: boolean;
  latestVersion: string;
  releaseNotes: string | null;
  onClose: () => void;
  onSkip: () => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      description={t("update.description", { version: latestVersion })}
      footer={
        <>
          <Button onClick={onSkip} style={styles.skipButton} variant="ghost">
            {t("update.skip")}
          </Button>
          <Button onClick={onClose}>{t("update.later")}</Button>
          <Button onClick={onDownload} variant="primary">
            {t("update.download")}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      style={styles.dialog}
      title={t("update.title")}
    >
      {releaseNotes ? (
        <div data-update-notes="" {...stylex.props(styles.notes)}>
          <ReactMarkdown
            components={releaseNotesComponents}
            remarkPlugins={[remarkGfm]}
          >
            {releaseNotes}
          </ReactMarkdown>
        </div>
      ) : null}
    </Dialog>
  );
}
