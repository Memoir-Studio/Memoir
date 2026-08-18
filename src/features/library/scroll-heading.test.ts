import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollHeadingInPreview } from "./scroll-heading";

afterEach(() => {
  document.body.replaceChildren();
});

describe("scrollHeadingInPreview", () => {
  it("scrolls only the preview pane and leaves ancestor scroll containers alone", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const shell = document.createElement("main");
    shell.className = "workspace-shell";
    const shellScrollTo = vi.fn();
    shell.scrollTo = shellScrollTo as HTMLElement["scrollTo"];

    const pane = document.createElement("section");
    pane.className = "preview-pane";
    const paneScrollTo = vi.fn();
    pane.scrollTo = paneScrollTo as HTMLElement["scrollTo"];
    Object.defineProperty(pane, "scrollTop", { configurable: true, value: 80 });
    pane.getBoundingClientRect = () =>
      ({ top: 100, left: 0, right: 0, bottom: 0, width: 0, height: 400, x: 0, y: 100, toJSON: () => ({}) });

    const heading = document.createElement("h3");
    heading.id = "links";
    heading.getBoundingClientRect = () =>
      ({ top: 260, left: 0, right: 0, bottom: 0, width: 0, height: 24, x: 0, y: 260, toJSON: () => ({}) });

    pane.append(heading);
    shell.append(pane);
    document.body.append(shell);

    expect(scrollHeadingInPreview("links", { behavior: "auto", offset: 12 })).toBe(true);
    expect(paneScrollTo).toHaveBeenCalledWith({ top: 228, behavior: "auto" });
    expect(shellScrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when the heading is not inside a preview pane", () => {
    const heading = document.createElement("h3");
    heading.id = "links";
    heading.scrollIntoView = vi.fn();
    document.body.append(heading);

    expect(scrollHeadingInPreview("links")).toBe(false);
    expect(heading.scrollIntoView).not.toHaveBeenCalled();
  });
});
