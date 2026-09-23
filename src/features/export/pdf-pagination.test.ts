import { describe, expect, it } from "vitest";
import { planPdfPageSegments } from "./pdf-pagination";

describe("planPdfPageSegments", () => {
  it("uses nearby block boundaries instead of splitting content", () => {
    expect(planPdfPageSegments(2_300, [0, 900, 1_700, 2_300], 1_000)).toEqual([
      { start: 0, end: 900 },
      { start: 900, end: 1_700 },
      { start: 1_700, end: 2_300 },
    ]);
  });

  it("fills the page when no useful block boundary exists", () => {
    expect(planPdfPageSegments(2_100, [100, 1_600], 1_000)).toEqual([
      { start: 0, end: 1_000 },
      { start: 1_000, end: 1_600 },
      { start: 1_600, end: 2_100 },
    ]);
  });

  it("filters invalid and duplicate breakpoints", () => {
    expect(planPdfPageSegments(700, [500, 500, -1, Number.NaN, 900], 1_000)).toEqual([
      { start: 0, end: 700 },
    ]);
  });

  it("rejects a non-positive page capacity", () => {
    expect(() => planPdfPageSegments(100, [], 0)).toThrow(
      "PDF page capacity must be greater than zero.",
    );
  });
});
