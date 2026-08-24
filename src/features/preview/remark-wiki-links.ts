import { splitHash } from "../../domain/note-links";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  url?: string;
  title?: string | null;
  data?: { hProperties?: Record<string, unknown> };
};

export const WIKI_LINK_PROTOCOL = "#memoir-note/";

export function wikiHref(inner: string) {
  return `${WIKI_LINK_PROTOCOL}${encodeURIComponent(inner)}`;
}

export function wikiInnerFromHref(href: string) {
  if (!href.startsWith(WIKI_LINK_PROTOCOL)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_LINK_PROTOCOL.length));
  } catch {
    return href.slice(WIKI_LINK_PROTOCOL.length);
  }
}

export function wikiDisplayText(inner: string) {
  const pipe = inner.indexOf("|");
  if (pipe >= 0) {
    const alias = inner.slice(pipe + 1).trim();
    if (alias) return alias;
  }
  const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
  const { path, heading } = splitHash(target);
  const name = path.split("/").pop()?.replace(/\.(md|mdx)$/i, "") || path;
  return heading ? `${name}#${heading}` : name;
}

export function remarkWikiLinks() {
  return (tree: MdastNode) => {
    visit(tree);
  };
}

function visit(node: MdastNode) {
  if (node.type === "code" || node.type === "inlineCode") return;
  const children = node.children;
  if (!children?.length) return;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child.type === "text" && child.value) {
      const parts = splitWikiText(child.value);
      if (parts.length !== 1 || parts[0]?.type !== "text" || parts[0].value !== child.value) {
        children.splice(index, 1, ...parts);
      }
      continue;
    }
    visit(child);
  }
}

function splitWikiText(value: string): MdastNode[] {
  const parts: MdastNode[] = [];
  const pattern = /\[\[([^\[\]]+)\]\]/g;
  let last = 0;
  let match = pattern.exec(value);
  while (match) {
    const index = match.index;
    if (index > 0 && value[index - 1] === "!") {
      match = pattern.exec(value);
      continue;
    }
    if (index > last) {
      parts.push({ type: "text", value: value.slice(last, index) });
    }
    const inner = match[1] || "";
    parts.push({
      type: "link",
      url: wikiHref(inner),
      title: null,
      children: [{ type: "text", value: wikiDisplayText(inner) }],
      data: { hProperties: { className: ["wiki-link"] } },
    });
    last = index + match[0].length;
    match = pattern.exec(value);
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts.length ? parts : [{ type: "text", value }];
}
