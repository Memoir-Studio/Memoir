import { isPreviewableHttpUrl } from "../../domain/link-preview";
import { wikiInnerFromHref } from "./remark-wiki-links";

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: unknown[];
  };
};

const LINK_CARD_HOST_CLASS = "memoir-link-card-host";

export function remarkLinkCards() {
  return (tree: MdastNode) => visit(tree, "");
}

export function readLinkCardProp(props: Record<string, unknown>, name: "url" | "label") {
  const kebab = name === "url" ? "data-link-card-url" : "data-link-card-label";
  const camel = name === "url" ? "dataLinkCardUrl" : "dataLinkCardLabel";
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const value = props[kebab] ?? props[camel] ?? nodeProperties[kebab] ?? nodeProperties[camel];
  return typeof value === "string" ? value : "";
}

function visit(node: MdastNode, parentType: string) {
  if (node.type === "code" || node.type === "inlineCode") return;
  if (node.type === "paragraph" && parentType === "root") {
    markStandaloneLink(node);
    return;
  }
  const children = node.children;
  if (!children?.length) return;
  for (const child of children) visit(child, node.type);
}

function markStandaloneLink(paragraph: MdastNode) {
  const url = standaloneHttpUrl(paragraph);
  if (!url) return;
  const label = linkLabel(paragraph, url);
  paragraph.data = {
    ...paragraph.data,
    hName: "div",
    hProperties: {
      ...paragraph.data?.hProperties,
      className: mergeClassName(paragraph.data?.hProperties?.className, LINK_CARD_HOST_CLASS),
      dataLinkCardUrl: url,
      ...(label ? { dataLinkCardLabel: label } : {}),
    },
    hChildren: [],
  };
}

function standaloneHttpUrl(paragraph: MdastNode) {
  const significant = (paragraph.children || []).filter((child) => !isIgnorable(child));
  if (significant.length !== 1) return null;
  const link = significant[0];
  if (!link || link.type !== "link" || !link.url) return null;
  if (wikiInnerFromHref(link.url)) return null;
  if (!isPreviewableHttpUrl(link.url)) return null;
  if (containsImage(link)) return null;
  return link.url;
}

function linkLabel(paragraph: MdastNode, url: string) {
  const text = nodeText(paragraph).trim();
  return text && text !== url ? text : "";
}

function isIgnorable(node: MdastNode) {
  return node.type === "break" || (node.type === "text" && !node.value?.trim());
}

function containsImage(node: MdastNode): boolean {
  if (node.type === "image") return true;
  return Boolean(node.children?.some(containsImage));
}

function nodeText(node: MdastNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children || []).map(nodeText).join("");
}

function mergeClassName(existing: unknown, extra: string) {
  if (Array.isArray(existing)) {
    return existing.includes(extra) ? existing : [...existing, extra];
  }
  if (typeof existing === "string" && existing.trim()) {
    return existing.split(/\s+/).includes(extra) ? existing.split(/\s+/) : [...existing.split(/\s+/), extra];
  }
  return [extra];
}
