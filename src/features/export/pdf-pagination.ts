export type PdfPageSegment = {
  start: number;
  end: number;
};

const MIN_SAFE_BREAK_FILL_RATIO = 0.45;

export function planPdfPageSegments(
  totalHeight: number,
  breakpoints: number[],
  pageCapacity: number,
): PdfPageSegment[] {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) return [];
  if (!Number.isFinite(pageCapacity) || pageCapacity <= 0) {
    throw new Error("PDF page capacity must be greater than zero.");
  }

  const safeBreakpoints = [...new Set(breakpoints)]
    .filter((value) => Number.isFinite(value) && value > 0 && value < totalHeight)
    .sort((left, right) => left - right);
  const pages: PdfPageSegment[] = [];
  let start = 0;

  while (start < totalHeight) {
    const capacityEnd = Math.min(start + pageCapacity, totalHeight);
    let end = capacityEnd;

    if (capacityEnd < totalHeight) {
      const earliestSafeBreak = start + pageCapacity * MIN_SAFE_BREAK_FILL_RATIO;
      for (const breakpoint of safeBreakpoints) {
        if (breakpoint > capacityEnd) break;
        if (breakpoint >= earliestSafeBreak) end = breakpoint;
      }
    }

    if (end <= start) end = capacityEnd;
    pages.push({ start, end });
    start = end;
  }

  return pages;
}
