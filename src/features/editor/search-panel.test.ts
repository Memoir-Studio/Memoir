import { search, openSearchPanel, closeSearchPanel, findNext, SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  SEARCH_MATCH_CAP,
  countSearchMatches,
  createMemoirSearchPanel,
  formatSearchCount,
  searchPanelLabels,
} from "./search-panel";

const views: EditorView[] = [];

function mount(doc = "Hello\nhello world", locale: "zh" | "en" = "zh") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        search({
          top: true,
          createPanel: createMemoirSearchPanel(searchPanelLabels(locale)),
        }),
      ],
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

describe("search match counts", () => {
  const labels = searchPanelLabels("zh");

  it("counts matches and marks the selected occurrence", () => {
    const state = EditorState.create({
      doc: "Hello\nHello world",
      selection: { anchor: 0, head: 5 },
    });
    expect(countSearchMatches(state, new SearchQuery({ search: "Hello" }))).toEqual({
      current: 1,
      total: 2,
      overflow: false,
    });
  });

  it("caps scanning on huge result sets", () => {
    const state = EditorState.create({ doc: "a".repeat(SEARCH_MATCH_CAP + 20) });
    const stats = countSearchMatches(state, new SearchQuery({ search: "a" }));
    expect(stats).toEqual({ current: 0, total: SEARCH_MATCH_CAP, overflow: true });
  });

  it("formats empty, invalid, miss, and overflow counts", () => {
    expect(formatSearchCount({ current: 0, total: 0, overflow: false }, labels, { search: "", valid: true })).toBe(
      "",
    );
    expect(
      formatSearchCount({ current: 0, total: 0, overflow: false }, labels, { search: "[", valid: false }),
    ).toBe("无效的正则");
    expect(
      formatSearchCount({ current: 0, total: 0, overflow: false }, labels, { search: "zz", valid: true }),
    ).toBe("无结果");
    expect(
      formatSearchCount({ current: 2, total: 12, overflow: false }, labels, { search: "Hello", valid: true }),
    ).toBe("2/12");
    expect(
      formatSearchCount({ current: 0, total: 12, overflow: false }, labels, { search: "Hello", valid: true }),
    ).toBe("–/12");
    expect(
      formatSearchCount({ current: 1, total: SEARCH_MATCH_CAP, overflow: true }, labels, {
        search: "a",
        valid: true,
      }),
    ).toBe(`1/${SEARCH_MATCH_CAP}+`);
  });
});

describe("Memoir search panel", () => {
  it("opens a localized panel at the top instead of the default CodeMirror form", () => {
    const view = mount();
    openSearchPanel(view);

    const panel = view.dom.querySelector(".memoir-search") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.closest(".cm-panels-top")).toBeTruthy();
    expect(panel.querySelector(".cm-button")).toBeNull();
    expect(panel.querySelector("input[type=checkbox]")).toBeNull();
    expect(view.dom.querySelector("[placeholder='Find']")).toBeNull();
    expect((view.dom.querySelector("[main-field]") as HTMLInputElement).placeholder).toBe("查找");
    expect(view.dom.querySelector("[aria-label='替换']")).toBeTruthy();
    expect(view.dom.querySelector("[aria-label='区分大小写']")?.textContent).toBe("Aa");
  });

  it("updates the match count and option toggles as the query changes", () => {
    const view = mount("alpha alpha beta");
    openSearchPanel(view);
    const input = view.dom.querySelector("[main-field]") as HTMLInputElement;
    const count = view.dom.querySelector(".memoir-search-count") as HTMLElement;

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(count.textContent).toBe("–/2");

    findNext(view);
    expect(count.textContent).toBe("1/2");
    findNext(view);
    expect(count.textContent).toBe("2/2");

    const caseButton = view.dom.querySelector("[aria-label='区分大小写']") as HTMLButtonElement;
    caseButton.click();
    expect(caseButton).toHaveAttribute("aria-pressed", "true");
    expect(caseButton).toHaveClass("is-active");
  });

  it("marks an invalid regular expression", () => {
    const view = mount();
    openSearchPanel(view);
    const input = view.dom.querySelector("[main-field]") as HTMLInputElement;
    const regexp = view.dom.querySelector("[aria-label='正则表达式']") as HTMLButtonElement;
    regexp.click();
    input.value = "[";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("is-invalid");
    expect(view.dom.querySelector(".memoir-search-count")?.textContent).toBe("无效的正则");
  });

  it("replaces the current match from the panel", () => {
    const view = mount("alpha alpha");
    openSearchPanel(view);
    const find = view.dom.querySelector("[main-field]") as HTMLInputElement;
    const replace = view.dom.querySelector("[aria-label='替换']") as HTMLInputElement;
    find.value = "alpha";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    findNext(view);
    replace.value = "beta";
    replace.dispatchEvent(new Event("input", { bubbles: true }));
    (view.dom.querySelector("[name=replace]") as HTMLButtonElement).click();
    expect(view.state.doc.toString()).toBe("beta alpha");
  });

  it("closes from the panel control", () => {
    const view = mount();
    openSearchPanel(view);
    expect(view.dom.querySelector(".memoir-search")).toBeTruthy();
    (view.dom.querySelector("[name=close]") as HTMLButtonElement).click();
    expect(view.dom.querySelector(".memoir-search")).toBeNull();
    closeSearchPanel(view);
  });

  it("uses English copy when the locale is English", () => {
    const view = mount("Hello", "en");
    openSearchPanel(view);
    expect((view.dom.querySelector("[main-field]") as HTMLInputElement).placeholder).toBe("Find");
    expect(view.dom.querySelector("[aria-label='Match case']")).toBeTruthy();
    expect(view.dom.querySelector("button[name=replaceAll]")?.textContent).toBe("Replace all");
  });
});
