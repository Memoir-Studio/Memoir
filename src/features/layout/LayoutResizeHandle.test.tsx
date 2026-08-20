import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayoutResizeHandle } from "./LayoutResizeHandle";

function dispatchPointer(target: Element, type: string, clientX: number) {
  fireEvent(
    target,
    new MouseEvent(type, {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX,
      clientY: 8,
    }),
  );
}

afterEach(() => {
  cleanup();
  document.body.classList.remove("is-layout-resizing");
});

describe("LayoutResizeHandle", () => {
  it("drags, keys, and double-clicks to change the value", () => {
    const onChange = vi.fn();
    const view = render(
      <LayoutResizeHandle
        defaultValue={164}
        label="Resize navigation"
        max={360}
        min={148}
        onChange={onChange}
        value={164}
      />,
    );
    const handle = view.getByRole("separator", { name: "Resize navigation" });

    dispatchPointer(handle, "pointerdown", 200);
    expect(document.body.classList.contains("is-layout-resizing")).toBe(true);
    dispatchPointer(handle, "pointermove", 240);
    expect(onChange).toHaveBeenLastCalledWith(204);
    dispatchPointer(handle, "pointerup", 240);
    expect(document.body.classList.contains("is-layout-resizing")).toBe(false);

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(176);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(148);
    fireEvent.doubleClick(handle);
    expect(onChange).toHaveBeenLastCalledWith(164);
  });
});
