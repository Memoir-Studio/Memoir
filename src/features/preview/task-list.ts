type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: {
    start?: {
      offset?: number;
    };
  };
};

function isTaskListItem(node: HastNode) {
  const className = node.properties?.className;
  return (
    node.tagName === "li" &&
    Array.isArray(className) &&
    className.includes("task-list-item")
  );
}

export function rehypeTaskOffsets() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      const offset = node.position?.start?.offset;
      if (isTaskListItem(node) && typeof offset === "number") {
        node.properties = {
          ...node.properties,
          "data-task-offset": offset,
        };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

export function toggleTaskAtOffset(
  content: string,
  taskOffset: number,
  checked: boolean,
) {
  const taskSource = content.slice(taskOffset);
  const marker = /^(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\]/.exec(taskSource);
  if (!marker) return content;

  const checkOffset = taskOffset + marker[0].lastIndexOf("[") + 1;
  const checkValue = checked ? "x" : " ";
  return `${content.slice(0, checkOffset)}${checkValue}${content.slice(checkOffset + 1)}`;
}
