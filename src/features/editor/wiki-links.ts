import * as stylex from "@stylexjs/stylex";
import { EditorState, Facet, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { noteStem, resolveNoteRef, splitHash, type NoteGraphNode } from "../../domain/note-links";
import { wikiStyles } from "./editor-styles.stylex";

export type WikiCatalogNote = Pick<NoteGraphNode, "relativePath" | "title">;

export const wikiNoteCatalog = Facet.define<WikiCatalogNote[], WikiCatalogNote[]>({
  combine: (values) => values[0] ?? [],
});

export const wikiSourcePath = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

const setWikiIndex = StateEffect.define<number>();

const wikiMatcher = new MatchDecorator({
  regexp: /\[\[([^\[\]]+)\]\]/g,
  decoration: Decoration.mark({ class: "cm-wiki-link" }),
});

export function wikiInsertToken(
  note: WikiCatalogNote,
  catalog: WikiCatalogNote[],
  query: string,
  preferPath = false,
) {
  const stem = noteStem(note.relativePath);
  const title = note.title.trim();
  const titleCount = catalog.filter((item) => item.title === title).length;
  if (preferPath || titleCount > 1 || !title) return stem;
  const needle = query.trim().toLowerCase();
  if (!needle) return title;
  const path = note.relativePath.toLowerCase();
  const stemLower = stem.toLowerCase();
  if (stemLower.startsWith(needle) || path.startsWith(needle) || path.includes(`/${needle}`)) return stem;
  if (title.toLowerCase().includes(needle)) return title;
  return stem;
}

class WikiCompleteWidget extends WidgetType {
  constructor(
    readonly options: WikiCatalogNote[],
    readonly active: number,
    readonly from: number,
    readonly to: number,
    readonly query: string,
  ) {
    super();
  }

  eq(other: WikiCompleteWidget) {
    return (
      this.active === other.active &&
      this.from === other.from &&
      this.to === other.to &&
      this.query === other.query &&
      this.options.length === other.options.length &&
      this.options.every(
        (note, index) =>
          note.relativePath === other.options[index]?.relativePath &&
          note.title === other.options[index]?.title,
      )
    );
  }

  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView) {
    const root = document.createElement("div");
    applyStylexAttrs(root, stylex.attrs(wikiStyles.completion));
    root.dataset.wikiComplete = "";
    root.setAttribute("role", "listbox");
    this.options.forEach((note, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.tabIndex = -1;
      applyStylexAttrs(
        option,
        stylex.attrs(wikiStyles.option, index === this.active && wikiStyles.optionActive),
      );
      option.dataset.wikiOption = "";
      option.setAttribute("role", "option");
      option.dataset.wikiPath = note.relativePath;
      option.setAttribute("aria-selected", index === this.active ? "true" : "false");
      const title = document.createElement("span");
      applyStylexAttrs(title, stylex.attrs(wikiStyles.title));
      title.textContent = note.title || noteStem(note.relativePath);
      const path = document.createElement("span");
      applyStylexAttrs(
        path,
        stylex.attrs(wikiStyles.path, index === this.active && wikiStyles.pathActive),
      );
      path.dataset.wikiCompletePath = "";
      path.textContent = note.relativePath;
      option.append(title, path);
      option.addEventListener("mouseenter", () => {
        if (index === this.active) return;
        view.dispatch({ effects: setWikiIndex.of(index) });
      });
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const preferPath =
          event.target instanceof Element && Boolean(event.target.closest("[data-wiki-complete-path]"));
        insertWikiNote(view, this.from, this.to, note, this.query, preferPath);
      });
      root.append(option);
    });
    root.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    return root;
  }
}

function applyStylexAttrs(element: Element, attrs: ReturnType<typeof stylex.attrs>) {
  if (attrs.class) element.setAttribute("class", attrs.class);
  if (attrs["data-style-src"]) {
    element.setAttribute("data-style-src", attrs["data-style-src"]);
  }
}

const wikiComplete = StateField.define<{
  from: number;
  to: number;
  query: string;
  index: number;
} | null>({
  create(state) {
    return wikiQueryAtState(state);
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setWikiIndex) && value) {
        return { ...value, index: effect.value };
      }
    }
    if (!transaction.docChanged && !transaction.selection) return value;
    const next = wikiQueryAtState(transaction.state);
    if (!next) return null;
    if (value && next.from === value.from && next.query === value.query) {
      return { ...next, index: value.index };
    }
    return next;
  },
});

export function wikiQueryInLine(line: string, lineFrom: number, localPos: number) {
  const pos = Math.max(0, Math.min(localPos, line.length));
  const start = line.lastIndexOf("[[", pos);
  if (start < 0) return null;
  const between = line.slice(start + 2, pos);
  if (between.includes("]]") || between.includes("\n")) return null;
  const before = start > 0 ? line[start - 1] : "";
  if (before === "!") return null;
  return { from: lineFrom + start + 2, to: lineFrom + pos, query: between, index: 0 };
}

export function wikiQueryAt(doc: string, pos: number) {
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const lineStart = clamped === 0 ? 0 : doc.lastIndexOf("\n", clamped - 1) + 1;
  const newline = doc.indexOf("\n", lineStart);
  const lineEnd = newline < 0 ? doc.length : newline;
  return wikiQueryInLine(doc.slice(lineStart, lineEnd), lineStart, clamped - lineStart);
}

function wikiQueryAtState(state: EditorState) {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  return wikiQueryInLine(line.text, line.from, pos - line.from);
}

function filteredCatalog(view: EditorView, query: string) {
  const catalog = view.state.facet(wikiNoteCatalog);
  const needle = query.trim().toLowerCase();
  return catalog
    .filter((note) => {
      if (!needle) return true;
      return (
        note.title.toLowerCase().includes(needle) ||
        note.relativePath.toLowerCase().includes(needle) ||
        noteStem(note.relativePath).toLowerCase().includes(needle)
      );
    })
    .slice(0, 8);
}

function insertWikiNote(
  view: EditorView,
  from: number,
  to: number,
  note: WikiCatalogNote,
  query: string,
  preferPath = false,
) {
  const catalog = view.state.facet(wikiNoteCatalog);
  const token = wikiInsertToken(note, catalog, query, preferPath);
  const after = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + 2));
  const insert = after === "]]" ? token : `${token}]]`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  view.focus();
}

const wikiHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = wikiMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = wikiMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const wikiCompletePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const query = view.state.field(wikiComplete);
      if (!query) return Decoration.none;
      const options = filteredCatalog(view, query.query);
      if (!options.length) return Decoration.none;
      const index = ((query.index % options.length) + options.length) % options.length;
      return Decoration.set([
        Decoration.widget({
          block: false,
          side: 1,
          widget: new WikiCompleteWidget(options, index, query.from, query.to, query.query),
        }).range(query.to),
      ]);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function activeWiki(view: EditorView) {
  const query = view.state.field(wikiComplete);
  if (!query) return null;
  const options = filteredCatalog(view, query.query);
  if (!options.length) return null;
  const index = ((query.index % options.length) + options.length) % options.length;
  return { query, options, index };
}

function moveWikiCompletion(view: EditorView, delta: number) {
  const active = activeWiki(view);
  if (!active) return false;
  view.dispatch({
    effects: setWikiIndex.of((active.index + delta + active.options.length) % active.options.length),
  });
  return true;
}

function acceptWikiCompletion(view: EditorView) {
  const active = activeWiki(view);
  if (!active) return false;
  const note = active.options[active.index];
  if (!note) return false;
  insertWikiNote(view, active.query.from, active.query.to, note, active.query.query);
  return true;
}

export function wikiLinkExtensions(onOpenNote?: (path: string) => void) {
  return [
    wikiComplete,
    wikiHighlight,
    wikiCompletePlugin,
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: (view) => moveWikiCompletion(view, 1) },
        { key: "ArrowUp", run: (view) => moveWikiCompletion(view, -1) },
        { key: "Enter", run: acceptWikiCompletion },
        { key: "Tab", run: acceptWikiCompletion },
      ]),
    ),
    EditorView.domEventHandlers({
      click(event, view) {
        if (!(event.metaKey || event.ctrlKey) || !onOpenNote) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const line = view.state.doc.lineAt(pos);
        const match = wikiAt(line.text, line.from, pos);
        if (!match) return false;
        const source = view.state.facet(wikiSourcePath);
        const resolved = resolveNoteRef(match, source, view.state.facet(wikiNoteCatalog));
        if (!resolved) return false;
        event.preventDefault();
        onOpenNote(resolved);
        return true;
      },
    }),
  ];
}

function wikiAt(line: string, lineFrom: number, pos: number) {
  const local = pos - lineFrom;
  const start = line.lastIndexOf("[[", local);
  if (start < 0) return null;
  const end = line.indexOf("]]", start + 2);
  if (end < 0 || local > end + 2) return null;
  return splitHash(line.slice(start + 2, end).split("|")[0] || "").path;
}
