import { LanguageDescription } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { fencedCodeLanguages } from "./code-languages";

describe("fencedCodeLanguages", () => {
  it("resolves common fence aliases", () => {
    expect(LanguageDescription.matchLanguageName(fencedCodeLanguages, "python")?.name).toBe("Python");
    expect(LanguageDescription.matchLanguageName(fencedCodeLanguages, "py")?.name).toBe("Python");
    expect(LanguageDescription.matchLanguageName(fencedCodeLanguages, "js")?.name).toBe("JavaScript");
    expect(LanguageDescription.matchLanguageName(fencedCodeLanguages, "ts")?.name).toBe("TypeScript");
    expect(LanguageDescription.matchLanguageName(fencedCodeLanguages, "bash")?.name).toBe("Shell");
  });

  it("leaves mermaid for the diagram renderer", () => {
    expect(LanguageDescription.matchLanguageName(fencedCodeLanguages, "mermaid")).toBeNull();
  });
});
