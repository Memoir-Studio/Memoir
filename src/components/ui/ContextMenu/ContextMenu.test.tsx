import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "./ContextMenu";

describe("ContextMenu", () => {
  it("selects an item, then closes", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <ContextMenu onClose={onClose} open x={12} y={20} label="笔记菜单">
        <ContextMenuItem label="收藏" onSelect={onSelect} />
        <ContextMenuSeparator />
        <ContextMenuItem danger label="删除" onSelect={() => undefined} />
      </ContextMenu>,
    );

    expect(view.getByRole("menu", { name: "笔记菜单" })).toBeInTheDocument();
    await user.click(view.getByRole("menuitem", { name: "收藏" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and outside pointer down", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenu onClose={onClose} open x={8} y={8}>
        <ContextMenuItem label="重命名" onSelect={() => undefined} />
      </ContextMenu>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
