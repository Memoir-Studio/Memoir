import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderAppearanceDialog } from "./FolderAppearanceDialog";

afterEach(cleanup);

describe("FolderAppearanceDialog", () => {
  it("selects an emoji and color, and can reset", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <FolderAppearanceDialog
        appearance={undefined}
        folder="日记"
        folderLabel="日记"
        onChange={onChange}
        onClose={() => undefined}
        open
      />,
    );

    await user.click(view.getByRole("button", { name: "📔" }));
    expect(onChange).toHaveBeenLastCalledWith({ emoji: "📔" });

    view.rerender(
      <FolderAppearanceDialog
        appearance={{ emoji: "📔" }}
        folder="日记"
        folderLabel="日记"
        onChange={onChange}
        onClose={() => undefined}
        open
      />,
    );

    await user.click(view.getByRole("button", { name: "珊瑚红" }));
    expect(onChange).toHaveBeenLastCalledWith({ emoji: "📔", color: "coral" });

    await user.click(view.getByRole("button", { name: "恢复默认" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("accepts a custom pasted emoji", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <FolderAppearanceDialog
        appearance={undefined}
        folder="思考"
        folderLabel="思考"
        onChange={onChange}
        onClose={() => undefined}
        open
      />,
    );

    await user.type(view.getByPlaceholderText("粘贴或输入一个 emoji"), "💡笔记");
    expect(onChange).toHaveBeenLastCalledWith({ emoji: "💡" });
  });
});
