import { LanguageDescription, LanguageSupport, StreamLanguage, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export const fencedCodeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "mjs", "cjs"],
    extensions: ["js", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((mod) => mod.javascript()),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript"],
    extensions: ["ts"],
    load: () =>
      import("@codemirror/lang-javascript").then((mod) => mod.javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    extensions: ["jsx"],
    load: () => import("@codemirror/lang-javascript").then((mod) => mod.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    extensions: ["tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then((mod) =>
        mod.javascript({ jsx: true, typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    extensions: ["py"],
    load: () => import("@codemirror/lang-python").then((mod) => mod.python()),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json"],
    extensions: ["json"],
    load: () => import("@codemirror/lang-json").then((mod) => mod.json()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs", "rust"],
    extensions: ["rs"],
    load: () => import("@codemirror/lang-rust").then((mod) => mod.rust()),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    extensions: ["go"],
    load: () => import("@codemirror/lang-go").then((mod) => mod.go()),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    extensions: ["sql"],
    load: () => import("@codemirror/lang-sql").then((mod) => mod.sql()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml", "yaml"],
    extensions: ["yml", "yaml"],
    load: () => import("@codemirror/lang-yaml").then((mod) => mod.yaml()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((mod) => mod.css()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/lang-html").then((mod) => mod.html()),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["xml"],
    extensions: ["xml"],
    load: () => import("@codemirror/lang-xml").then((mod) => mod.xml()),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["c", "h", "cc", "cpp", "cxx", "hpp", "c++"],
    extensions: ["c", "h", "cc", "cpp", "cxx", "hpp"],
    load: () => import("@codemirror/lang-cpp").then((mod) => mod.cpp()),
  }),
  LanguageDescription.of({
    name: "Java",
    alias: ["java"],
    extensions: ["java"],
    load: () => import("@codemirror/lang-java").then((mod) => mod.java()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh", "shell"],
    extensions: ["sh", "bash"],
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then(
        (mod) => new LanguageSupport(StreamLanguage.define(mod.shell)),
      ),
  }),
];

const codeBlockLine = Decoration.line({ class: "cm-md-codeblock" });

function decorateCodeBlockLines(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const first = view.state.doc.lineAt(node.from);
        const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
        for (let number = first.number; number <= last.number; number += 1) {
          const line = view.state.doc.line(number);
          builder.add(line.from, line.from, codeBlockLine);
        }
      },
    });
  }
  return builder.finish();
}

export function fencedCodeBlockHighlighter() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorateCodeBlockLines(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = decorateCodeBlockLines(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}
