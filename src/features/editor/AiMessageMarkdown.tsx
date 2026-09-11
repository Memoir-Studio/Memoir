import { memo } from "react";
import * as stylex from "@stylexjs/stylex";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getGateways } from "../../gateways";
import { colors, accents, typography } from "../../styles/tokens.stylex";

const components: Components = {
  p: ({ children }) => <p {...stylex.props(styles.paragraph)}>{children}</p>,
  h1: ({ children }) => <h1 {...stylex.props(styles.heading)}>{children}</h1>,
  h2: ({ children }) => <h2 {...stylex.props(styles.heading)}>{children}</h2>,
  h3: ({ children }) => <h3 {...stylex.props(styles.heading)}>{children}</h3>,
  h4: ({ children }) => <h4 {...stylex.props(styles.heading)}>{children}</h4>,
  h5: ({ children }) => <h5 {...stylex.props(styles.heading)}>{children}</h5>,
  h6: ({ children }) => <h6 {...stylex.props(styles.heading)}>{children}</h6>,
  ul: ({ children }) => <ul {...stylex.props(styles.list)}>{children}</ul>,
  ol: ({ children, start }) => <ol start={start} {...stylex.props(styles.list)}>{children}</ol>,
  pre: ({ children }) => <pre {...stylex.props(styles.pre)}>{children}</pre>,
  code: ({ children }) => <code {...stylex.props(styles.code)}>{children}</code>,
  blockquote: ({ children }) => <blockquote {...stylex.props(styles.quote)}>{children}</blockquote>,
  table: ({ children }) => <div {...stylex.props(styles.tableScroll)}><table {...stylex.props(styles.table)}>{children}</table></div>,
  th: ({ children }) => <th {...stylex.props(styles.cell)}>{children}</th>,
  td: ({ children }) => <td {...stylex.props(styles.cell)}>{children}</td>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    event.preventDefault();
    if (href && /^https?:\/\//i.test(href)) void getGateways().system.openExternal(href);
  }} {...stylex.props(styles.link)}>{children}</a>,
  // Keep replies self-contained; do not fetch remote images while tokens arrive.
  img: ({ alt }) => <span>{alt}</span>,
};

export const AiMessageMarkdown = memo(function AiMessageMarkdown({ content }: { content: string }) {
  return <div {...stylex.props(styles.body)}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{content}</ReactMarkdown></div>;
});

const styles = stylex.create({
  body: { minWidth: 0, color: colors.text, fontSize: "12px", lineHeight: 1.65, overflowWrap: "anywhere" },
  paragraph: { margin: "0 0 8px", whiteSpace: "pre-wrap" },
  heading: { margin: "12px 0 6px", fontSize: "14px", fontWeight: 650, lineHeight: 1.4 },
  list: { margin: "6px 0", paddingLeft: "20px" },
  pre: { overflowX: "auto", padding: "10px", margin: "8px 0", borderRadius: "6px", backgroundColor: colors.canvas, whiteSpace: "pre", fontSize: "11px" },
  code: { fontFamily: typography.monoFont, backgroundColor: colors.canvas, borderRadius: "3px" },
  quote: { margin: "8px 0", paddingLeft: "10px", borderLeftWidth: "2px", borderLeftStyle: "solid", borderLeftColor: accents.primary, color: colors.muted },
  tableScroll: { maxWidth: "100%", overflowX: "auto", marginBlock: "8px" },
  table: { borderCollapse: "collapse", fontSize: "11px", width: "100%" },
  cell: { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border, padding: "5px 8px", textAlign: "left" },
  link: { color: accents.primary, textDecoration: "underline" },
});
