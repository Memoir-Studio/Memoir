type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: {
    start?: {
      line?: number;
    };
  };
};

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "pre",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "hr",
  "img",
  "figure",
  "figcaption",
  "aside",
  "section",
  "div",
]);

export function rehypeSourceLines() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      const line = node.position?.start?.line;
      if (
        node.type === "element" &&
        node.tagName &&
        BLOCK_TAGS.has(node.tagName) &&
        typeof line === "number" &&
        line > 0
      ) {
        node.properties = {
          ...node.properties,
          "data-source-line": line,
        };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}
