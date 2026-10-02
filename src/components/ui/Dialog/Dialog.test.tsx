import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

function DialogHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        打开
      </button>
      <Dialog
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        open={open}
        title="测试对话框"
      >
        <button type="button">第一个</button>
        <button type="button">最后一个</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("traps tab focus, closes on Escape and restores trigger focus", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(<DialogHarness onClose={onClose} />);
    const trigger = view.getByRole("button", { name: "打开" });
    await user.click(trigger);
    expect(view.getByRole("button", { name: "关闭" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(view.getByRole("button", { name: "最后一个" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("submits from a field when Enter is pressed", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <Dialog
        footer={<button type="submit">保存</button>}
        onClose={() => undefined}
        onSubmit={onSubmit}
        open
        title="测试对话框"
      >
        <input aria-label="标题" autoFocus />
      </Dialog>,
    );

    await user.type(view.getByRole("textbox", { name: "标题" }), "天气好{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not submit when Enter is pressed on a cancel button", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <Dialog
        footer={
          <>
            <button type="button">取消</button>
            <button type="submit">保存</button>
          </>
        }
        onClose={() => undefined}
        onSubmit={onSubmit}
        open
        title="测试对话框"
      >
        <input aria-label="标题" />
      </Dialog>,
    );

    await user.click(view.getByRole("button", { name: "取消" }));
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
