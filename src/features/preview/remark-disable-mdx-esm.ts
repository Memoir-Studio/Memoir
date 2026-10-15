type MdastNode = {
  type: string;
  children?: MdastNode[];
};

export const MDX_IMPORT_EXPORT_DISABLED = "MDX_IMPORT_EXPORT_DISABLED";

export function remarkDisableMdxEsm() {
  return (tree: MdastNode) => {
    function visit(node: MdastNode) {
      if (node.type === "mdxjsEsm") {
        throw new Error(MDX_IMPORT_EXPORT_DISABLED);
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
