import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

HTMLCanvasElement.prototype.getContext = function (type: string) {
  if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
  if (type !== "2d") return null;
  const noop = () => undefined;
  return {
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    stroke: noop,
    fill: noop,
    quadraticCurveTo: noop,
    setLineDash: noop,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D;
} as typeof HTMLCanvasElement.prototype.getContext;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
