import { describe, expect, it } from "vitest";
import { fileDropTargetFromPoint, toCssPoint } from "./file-drop";

describe("native file drop helpers", () => {
  it("converts physical drop coordinates through scale and UI zoom", () => {
    expect(toCssPoint({ x: 200, y: 100 }, 2, 1)).toEqual({ x: 100, y: 50 });
    expect(toCssPoint({ x: 200, y: 100 }, 2, 1.25)).toEqual({ x: 80, y: 40 });
  });

  it("only treats the editor pane as a drop target", () => {
    const root = document.implementation.createHTMLDocument();
    const pane = root.createElement("section");
    pane.className = "editor-pane";
    const sidebar = root.createElement("aside");
    sidebar.className = "library-sidebar";
    root.body.append(pane, sidebar);
    pane.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }) as DOMRect;
    root.elementFromPoint = (x: number, y: number) => (x < 200 && y < 200 ? pane : sidebar);
    expect(fileDropTargetFromPoint(20, 20, root)).toBe("editor");
    expect(fileDropTargetFromPoint(240, 20, root)).toBeNull();
  });
});
