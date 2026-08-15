import { describe, expect, it } from "vitest";
import { toggleTaskAtOffset } from "./task-list";

describe("toggleTaskAtOffset", () => {
  it("toggles only the task at the given offset", () => {
    const content = "- [ ] 重复任务\n- [ ] 重复任务\n";
    const secondTaskOffset = content.indexOf("- [ ]", 1);

    expect(toggleTaskAtOffset(content, secondTaskOffset, true)).toBe(
      "- [ ] 重复任务\n- [x] 重复任务\n",
    );
  });

  it("supports frontmatter, nested tasks, and uppercase checked markers", () => {
    const content = "---\ntitle: Tasks\n---\n- [ ] 父任务\n  1. [X] 子任务\n";
    const nestedTaskOffset = content.indexOf("1. [X]");

    expect(toggleTaskAtOffset(content, nestedTaskOffset, false)).toBe(
      "---\ntitle: Tasks\n---\n- [ ] 父任务\n  1. [ ] 子任务\n",
    );
  });

  it("leaves content unchanged when the offset is not a task item", () => {
    const content = "- 普通列表\n";

    expect(toggleTaskAtOffset(content, 0, true)).toBe(content);
  });
});
