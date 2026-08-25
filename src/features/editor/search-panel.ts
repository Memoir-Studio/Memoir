import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import type { AppLocale } from "../../domain/settings";
import { interpolate, t } from "../../i18n/translate";

export const SEARCH_MATCH_CAP = 999;

export type SearchPanelLabels = {
  panel: string;
  find: string;
  replace: string;
  findNext: string;
  findPrevious: string;
  replaceOne: string;
  replaceAll: string;
  matchCase: string;
  wholeWord: string;
  regexp: string;
  close: string;
  matches: string;
  matchesOverflow: string;
  noResults: string;
  invalid: string;
};

export type SearchMatchStats = {
  current: number;
  total: number;
  overflow: boolean;
};

export function searchPanelLabels(locale: AppLocale): SearchPanelLabels {
  return {
    panel: t(locale, "editor.search"),
    find: t(locale, "editor.find"),
    replace: t(locale, "editor.replace"),
    findNext: t(locale, "editor.findNext"),
    findPrevious: t(locale, "editor.findPrevious"),
    replaceOne: t(locale, "editor.replaceOne"),
    replaceAll: t(locale, "editor.replaceAll"),
    matchCase: t(locale, "editor.matchCase"),
    wholeWord: t(locale, "editor.wholeWord"),
    regexp: t(locale, "editor.regexp"),
    close: t(locale, "editor.closeSearch"),
    matches: t(locale, "editor.searchMatches"),
    matchesOverflow: t(locale, "editor.searchMatchesOverflow"),
    noResults: t(locale, "editor.searchNoResults"),
    invalid: t(locale, "editor.searchInvalid"),
  };
}

export function countSearchMatches(
  state: EditorState,
  query: SearchQuery,
  cap = SEARCH_MATCH_CAP,
): SearchMatchStats {
  if (!query.valid || !query.search) {
    return { current: 0, total: 0, overflow: false };
  }
  let total = 0;
  let current = 0;
  const selection = state.selection.main;
  const cursor = query.getCursor(state);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    total += 1;
    if (step.value.from === selection.from && step.value.to === selection.to) {
      current = total;
    }
    if (total >= cap) {
      return { current, total, overflow: true };
    }
  }
  return { current, total, overflow: false };
}

export function formatSearchCount(
  stats: SearchMatchStats,
  labels: Pick<SearchPanelLabels, "matches" | "matchesOverflow" | "noResults" | "invalid">,
  query: { search: string; valid: boolean },
): string {
  if (!query.search) return "";
  if (!query.valid) return labels.invalid;
  if (stats.total === 0) return labels.noResults;
  const current = stats.current > 0 ? String(stats.current) : "–";
  const template = stats.overflow ? labels.matchesOverflow : labels.matches;
  return interpolate(template, { current, total: stats.total });
}

export function createMemoirSearchPanel(labels: SearchPanelLabels) {
  return (view: EditorView): Panel => new MemoirSearchPanel(view, labels);
}

class MemoirSearchPanel implements Panel {
  readonly top = true;
  readonly dom: HTMLElement;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;
  private readonly regexpButton: HTMLButtonElement;
  private readonly count: HTMLElement;

  constructor(
    private readonly view: EditorView,
    private readonly labels: SearchPanelLabels,
  ) {
    this.query = getSearchQuery(view.state);
    this.searchField = textField({
      value: this.query.search,
      placeholder: labels.find,
      label: labels.find,
      main: true,
    });
    this.replaceField = textField({
      value: this.query.replace,
      placeholder: labels.replace,
      label: labels.replace,
    });
    this.caseButton = toggle(labels.matchCase, "Aa", this.query.caseSensitive);
    this.wordButton = toggle(labels.wholeWord, "ab", this.query.wholeWord);
    this.regexpButton = toggle(labels.regexp, ".*", this.query.regexp);
    this.count = elt("span", { class: "memoir-search-count", "aria-live": "polite" });
    this.searchField.addEventListener("input", () => this.commit());
    this.replaceField.addEventListener("input", () => this.commit());
    this.caseButton.addEventListener("click", () => this.flip(this.caseButton));
    this.wordButton.addEventListener("click", () => this.flip(this.wordButton));
    this.regexpButton.addEventListener("click", () => this.flip(this.regexpButton));

    const findControls: Node[] = [
      wrapField(icon("search"), this.searchField),
      this.count,
      group([
        iconButton(labels.findPrevious, "previous", icon("up"), () => findPrevious(view)),
        iconButton(labels.findNext, "next", icon("down"), () => findNext(view)),
      ]),
      group([this.caseButton, this.wordButton, this.regexpButton]),
      iconButton(labels.close, "close", icon("close"), () => closeSearchPanel(view)),
    ];
    const replaceControls: Node[] = view.state.readOnly
      ? []
      : [
          wrapField(icon("replace"), this.replaceField),
          group(
            [
              textButton(labels.replaceOne, "replace", () => replaceNext(view)),
              textButton(labels.replaceAll, "replaceAll", () => replaceAll(view)),
            ],
            "memoir-search-replace-actions",
          ),
        ];

    this.dom = elt(
      "div",
      {
        class: "memoir-search",
        role: "search",
        "aria-label": labels.panel,
      },
      [...findControls, ...replaceControls],
    );
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    this.syncFieldState();
    this.refreshCount();
  }

  mount() {
    this.searchField.select();
  }

  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setSearchQuery)),
      )
    ) {
      this.refreshCount();
    }
  }

  private keydown(event: KeyboardEvent) {
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter") return;
    if (event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
      return;
    }
    if (event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }

  private flip(button: HTMLButtonElement) {
    setPressed(button, !pressed(button));
    this.commit();
  }

  private commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: pressed(this.caseButton),
      regexp: pressed(this.regexpButton),
      wholeWord: pressed(this.wordButton),
      replace: this.replaceField.value,
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.syncFieldState();
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private setQuery(query: SearchQuery) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    setPressed(this.caseButton, query.caseSensitive);
    setPressed(this.wordButton, query.wholeWord);
    setPressed(this.regexpButton, query.regexp);
    this.syncFieldState();
  }

  private syncFieldState() {
    const invalid = Boolean(this.query.search) && this.query.regexp && !this.query.valid;
    this.searchField.classList.toggle("is-invalid", invalid);
    this.searchField.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  private refreshCount() {
    const stats = countSearchMatches(this.view.state, this.query);
    const text = formatSearchCount(stats, this.labels, this.query);
    this.count.textContent = text;
    this.count.classList.toggle("is-empty", !text);
    this.count.classList.toggle("is-invalid", Boolean(this.query.search) && !this.query.valid);
  }
}

function textField({
  value,
  placeholder,
  label,
  main = false,
}: {
  value: string;
  placeholder: string;
  label: string;
  main?: boolean;
}) {
  const input = elt("input", {
    class: "memoir-input memoir-search-field",
    value,
    placeholder,
    "aria-label": label,
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
  });
  if (main) input.setAttribute("main-field", "true");
  return input;
}

function toggle(label: string, glyph: string, on: boolean) {
  const button = elt("button", {
    type: "button",
    class: "memoir-search-toggle",
    "aria-label": label,
    title: label,
    "aria-pressed": on ? "true" : "false",
  });
  button.textContent = glyph;
  button.classList.toggle("is-active", on);
  keepFocus(button);
  return button;
}

function iconButton(label: string, name: string, child: Node, onClick: () => void) {
  const button = elt("button", {
    type: "button",
    class: "memoir-search-icon",
    name,
    "aria-label": label,
    title: label,
  });
  button.append(child);
  button.addEventListener("click", onClick);
  keepFocus(button);
  return button;
}

function textButton(label: string, name: string, onClick: () => void) {
  const button = elt("button", {
    type: "button",
    class: "memoir-button memoir-button-secondary memoir-button-sm memoir-search-action",
    name,
  });
  button.textContent = label;
  button.addEventListener("click", onClick);
  keepFocus(button);
  return button;
}

function wrapField(leading: Node, field: HTMLInputElement) {
  return elt("div", { class: "memoir-search-field-wrap" }, [leading, field]);
}

function group(children: Node[], className = "") {
  return elt(
    "div",
    { class: className ? `memoir-search-group ${className}` : "memoir-search-group" },
    children,
  );
}

function keepFocus(button: HTMLButtonElement) {
  button.addEventListener("mousedown", (event) => event.preventDefault());
}

function pressed(button: HTMLButtonElement) {
  return button.getAttribute("aria-pressed") === "true";
}

function setPressed(button: HTMLButtonElement, on: boolean) {
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.classList.toggle("is-active", on);
}

function icon(name: "search" | "replace" | "up" | "down" | "close") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  replace:
    '<path d="M14 4h6v6"/><path d="m20 4-7 7"/><path d="M10 20H4v-6"/><path d="m4 20 7-7"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "value" && node instanceof HTMLInputElement) {
      node.value = value;
      continue;
    }
    node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
