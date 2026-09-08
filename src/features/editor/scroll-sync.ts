export type ScrollAnchor = {
  line: number;
  top: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function countDocumentLines(content: string) {
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

export function bodySourceLineOffset(content: string, body: string) {
  if (!body || !content.endsWith(body)) return 0;
  const prefix = content.slice(0, content.length - body.length);
  return prefix.match(/\n/g)?.length ?? 0;
}

export function syncViewportOffset(clientHeight: number) {
  return Math.min(48, Math.max(0, clientHeight * 0.12));
}

export function collectPreviewAnchors(scroller: HTMLElement, lineOffset = 0): ScrollAnchor[] {
  const scrollerTop = scroller.getBoundingClientRect().top;
  const byLine = new Map<number, number>();

  for (const node of scroller.querySelectorAll<HTMLElement>("[data-source-line]")) {
    const bodyLine = Number(node.dataset.sourceLine);
    if (!Number.isFinite(bodyLine) || bodyLine < 1) continue;
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const line = bodyLine + lineOffset;
    const top = rect.top - scrollerTop + scroller.scrollTop;
    const existing = byLine.get(line);
    if (existing === undefined || top < existing) byLine.set(line, top);
  }

  return [...byLine.entries()]
    .map(([line, top]) => ({ line, top }))
    .sort((left, right) => left.line - right.line || left.top - right.top);
}

export function scrollTopForLine(
  line: number,
  anchors: ScrollAnchor[],
  scroller: Pick<HTMLElement, "scrollHeight" | "clientHeight">,
  lastLine: number,
  viewportOffset = 0,
) {
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (maxScroll <= 0) return 0;
  const points = withSentinels(anchors, lastLine, scroller.scrollHeight);
  if (points.length < 2) {
    const progress = lastLine <= 1 ? 0 : (line - 1) / (lastLine - 1);
    return clamp(progress, 0, 1) * maxScroll;
  }
  return clamp(interpolateY(line, points) - viewportOffset, 0, maxScroll);
}

export function lineForScrollTop(
  scrollTop: number,
  anchors: ScrollAnchor[],
  scroller: Pick<HTMLElement, "scrollHeight" | "clientHeight">,
  lastLine: number,
  viewportOffset = 0,
) {
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const points = withSentinels(anchors, lastLine, scroller.scrollHeight);
  if (points.length < 2) {
    if (maxScroll <= 0 || lastLine <= 1) return 1;
    return 1 + (scrollTop / maxScroll) * (lastLine - 1);
  }
  return interpolateLine(scrollTop + viewportOffset, points);
}

function withSentinels(anchors: ScrollAnchor[], lastLine: number, contentHeight: number) {
  const endLine = Math.max(lastLine + 1, 2);
  const points: ScrollAnchor[] = [{ line: 1, top: 0 }];
  for (const anchor of anchors) {
    if (anchor.line <= 1 || anchor.line >= endLine) continue;
    points.push(anchor);
  }
  points.push({ line: endLine, top: Math.max(contentHeight, 0) });
  return ensureMonotonic(points);
}

function ensureMonotonic(anchors: ScrollAnchor[]) {
  const points: ScrollAnchor[] = [];
  for (const anchor of anchors) {
    const previous = points[points.length - 1];
    if (!previous) {
      points.push(anchor);
      continue;
    }
    if (anchor.line <= previous.line) continue;
    points.push(anchor.top < previous.top ? { line: anchor.line, top: previous.top } : anchor);
  }
  return points;
}

function interpolateY(line: number, points: ScrollAnchor[]) {
  if (line <= points[0].line) return points[0].top;
  for (let index = 0; index < points.length - 1; index += 1) {
    const next = points[index + 1];
    if (line > next.line) continue;
    const previous = points[index];
    const span = next.line - previous.line;
    if (span <= 0) return previous.top;
    return previous.top + ((line - previous.line) / span) * (next.top - previous.top);
  }
  return points[points.length - 1].top;
}

function interpolateLine(top: number, points: ScrollAnchor[]) {
  if (top <= points[0].top) return points[0].line;
  for (let index = 0; index < points.length - 1; index += 1) {
    const next = points[index + 1];
    if (top > next.top) continue;
    const previous = points[index];
    const span = next.top - previous.top;
    if (span <= 0) return previous.line;
    return previous.line + ((top - previous.top) / span) * (next.line - previous.line);
  }
  return points[points.length - 1].line;
}
