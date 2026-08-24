import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { wikiInsertToken, wikiLinkExtensions, wikiNoteCatalog, wikiQueryAt } from "./wiki-links";

const catalog = [
  { relativePath: "markdown-语法示例.md", title: "Markdown 语法示例" },
  { relativePath: "1.mdx", title: "测试" },
];

const views: EditorView[] = [];

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [wikiNoteCatalog.of(catalog), ...wikiLinkExtensions(), keymap.of(defaultKeymap)],
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length) {
    const view = views.pop();
    view?.destroy();
    view?.dom.parentElement?.remove();
  }
});

describe("wiki insert token", () => {
  it("completes a filename stem when the query matches the path", () => {
    expect(wikiInsertToken(catalog[0]!, catalog, "mark")).toBe("markdown-语法示例");
  });

  it("completes the title when the query matches only the title", () => {
    expect(wikiInsertToken(catalog[0]!, catalog, "语法")).toBe("Markdown 语法示例");
  });

  it("inserts the filename stem when the path row is chosen", () => {
    expect(wikiInsertToken(catalog[0]!, catalog, "语法", true)).toBe("markdown-语法示例");
  });
});

describe("wiki query", () => {
  it("reads an open wiki token at the cursor", () => {
    expect(wikiQueryAt("See [[mark", 10)).toEqual({ from: 6, to: 10, query: "mark", index: 0 });
    expect(wikiQueryAt("See [[mark]]", 12)).toBeNull();
  });

  it("only inspects the cursor line", () => {
    expect(wikiQueryAt("See [[mark\nlater", 16)).toBeNull();
    const doc = "intro\nSee [[here";
    expect(wikiQueryAt(doc, doc.length)).toEqual({
      from: 12,
      to: 16,
      query: "here",
      index: 0,
    });
  });
});

describe("wiki completion widget", () => {
  it("inserts the matching filename when clicking a suggestion", () => {
    const view = mount("See [[mark");
    const option = view.dom.querySelector(".wiki-complete-option") as HTMLButtonElement | null;
    expect(option).toBeTruthy();
    expect(option?.querySelector(".wiki-complete-path")?.textContent).toBe("markdown-语法示例.md");
    option?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("See [[markdown-语法示例]]");
  });

  it("inserts the filename stem when clicking the path", () => {
    const view = mount("See [[语法");
    const path = view.dom.querySelector(".wiki-complete-path") as HTMLElement | null;
    expect(path?.textContent).toBe("markdown-语法示例.md");
    path?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("See [[markdown-语法示例]]");
  });

  it("moves the highlight with arrow keys and accepts with Enter", () => {
    const view = mount("[[");
    const options = [...view.dom.querySelectorAll(".wiki-complete-option")];
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveClass("is-active");
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    const afterDown = [...view.dom.querySelectorAll(".wiki-complete-option")];
    expect(afterDown[1]).toHaveClass("is-active");
    expect(afterDown[0]).not.toHaveClass("is-active");
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe("[[测试]]");
  });

  it("does not duplicate closing brackets when they already exist", () => {
    const doc = "See [[mark]]";
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({
        doc,
        selection: { anchor: 10 },
        extensions: [wikiNoteCatalog.of(catalog), ...wikiLinkExtensions()],
      }),
    });
    views.push(view);
    const option = view.dom.querySelector(".wiki-complete-option") as HTMLButtonElement | null;
    option?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("See [[markdown-语法示例]]");
  });
});
