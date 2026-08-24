import { describe, expect, it } from "vitest";
import { wikiDisplayText, wikiHref, wikiInnerFromHref } from "./remark-wiki-links";

describe("wiki link helpers", () => {
  it("round-trips the memoir note protocol and display text", () => {
    const href = wikiHref("Alpha#Setup|install");
    expect(wikiInnerFromHref(href)).toBe("Alpha#Setup|install");
    expect(wikiDisplayText("Alpha#Setup|install")).toBe("install");
    expect(wikiDisplayText("work/alpha.md")).toBe("alpha");
    expect(wikiInnerFromHref("https://example.com")).toBeNull();
  });
});
