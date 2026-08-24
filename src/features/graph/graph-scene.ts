import {
  degreesFromEdges,
  layoutEnergy,
  neighborSet,
  seedLayout,
  tickLayout,
  type LayoutEdge,
  type LayoutNode,
} from "./force-layout";
import type { GraphTheme } from "./graph-theme";

export type GraphSceneNode = {
  id: string;
  title: string;
};

export type GraphSceneEdge = {
  source: string;
  target: string;
};

export type NodeKind = "selected" | "neighbor" | "plain" | "muted";

export type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type GraphCamera = {
  x: number;
  y: number;
  scale: number;
};

type Handlers = {
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

type NodeView = {
  id: string;
  title: string;
  degree: number;
  label: HTMLButtonElement;
};

const WARMUP = 80;
const POINTER_CLICK_PX = 5;
const MIN_SCALE = 0.28;
const MAX_SCALE = 2.2;
const CAMERA_EASE = 0.2;

export function nodeRadius(kind: NodeKind) {
  if (kind === "selected") return 16;
  if (kind === "neighbor") return 12.5;
  if (kind === "plain") return 10.5;
  return 8;
}

export function boundsOf(nodes: Array<{ x: number; y: number }>): GraphBounds {
  if (!nodes.length) return { minX: -120, minY: -80, maxX: 120, maxY: 80 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  return { minX, minY, maxX, maxY };
}

export function fitView(bounds: GraphBounds, width: number, height: number): GraphCamera {
  if (width < 8 || height < 8) return { x: 0, y: 0, scale: 1 };
  const padding = 92;
  const minSpanX = 260;
  const minSpanY = 180;
  const spanX = Math.max(bounds.maxX - bounds.minX, minSpanX);
  const spanY = Math.max(bounds.maxY - bounds.minY, minSpanY);
  const scale = Math.min(
    Math.max(MIN_SCALE, Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)),
    1.38,
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale,
  };
}

function parseRgb(value: string): [number, number, number] {
  const hex = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    const n = short[1];
    return [parseInt(n[0] + n[0], 16), parseInt(n[1] + n[1], 16), parseInt(n[2] + n[2], 16)];
  }
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full) {
    const n = parseInt(full[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(hex);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [80, 80, 76];
}

function rgba(color: string, alpha: number) {
  const [r, g, b] = parseRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function flowDashOffset(nowMs: number, speedPxPerSec: number, scale: number) {
  return -((nowMs / 1000) * speedPxPerSec) / Math.max(scale, 0.001);
}

export function flowParticleT(nowMs: number, periodMs: number, phase: number) {
  const period = Math.max(periodMs, 1);
  const t = nowMs / period + phase;
  return t - Math.floor(t);
}

export function edgePhase(source: string, target: string) {
  let hash = 2166136261;
  const key = `${source}\0${target}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export class NoteGraphScene {
  private readonly host: HTMLElement;
  private readonly handlers: Handlers;
  private readonly canvas: HTMLCanvasElement;
  private readonly labels: HTMLDivElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private theme: GraphTheme;
  private nodes = new Map<string, NodeView>();
  private layout: LayoutNode[] = [];
  private layoutEdges: LayoutEdge[] = [];
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private cluster = new Set<string>();
  private camera: GraphCamera = { x: 0, y: 0, scale: 1 };
  private cameraTarget: GraphCamera = { x: 0, y: 0, scale: 1 };
  private animatingCamera = false;
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private lastPointer = { x: 0, y: 0 };
  private panLast = { x: 0, y: 0 };
  private panning = false;
  private draggingId: string | null = null;
  private dragged = false;
  private hasSized = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement, theme: GraphTheme, handlers: Handlers) {
    this.host = host;
    this.theme = theme;
    this.handlers = handlers;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "note-graph-canvas";
    this.canvas.setAttribute("role", "img");
    this.labels = document.createElement("div");
    this.labels.className = "note-graph-labels";
    host.prepend(this.canvas);
    host.append(this.labels);
    this.ctx = this.canvas.getContext("2d");
    this.bind();
    this.resize();
    this.loop();
  }

  setTheme(theme: GraphTheme) {
    this.theme = theme;
    this.draw();
  }

  setGraph(nodes: GraphSceneNode[], edges: GraphSceneEdge[], selectedId: string | null) {
    this.selectedId = selectedId;
    const ids = nodes.map((node) => node.id);
    const idSet = new Set(ids);
    const layoutEdges = edges.filter(
      (edge) => idSet.has(edge.source) && idSet.has(edge.target) && edge.source !== edge.target,
    );
    const degrees = degreesFromEdges(ids, layoutEdges);
    const sameNodes = ids.length === this.nodes.size && ids.every((id) => this.nodes.has(id));
    const prevEdgeKeys = new Set(this.layoutEdges.map((edge) => `${edge.source}\0${edge.target}`));
    const edgesChanged =
      prevEdgeKeys.size !== layoutEdges.length ||
      layoutEdges.some((edge) => !prevEdgeKeys.has(`${edge.source}\0${edge.target}`));

    this.layoutEdges = layoutEdges;
    this.cluster = neighborSet(this.selectedId, this.layoutEdges);

    if (sameNodes) {
      for (const node of nodes) {
        const view = this.nodes.get(node.id);
        if (!view) continue;
        view.degree = degrees.get(node.id) ?? 0;
        if (view.title !== node.title) {
          view.title = node.title;
          view.label.textContent = node.title;
        }
      }
      for (const node of this.layout) node.degree = degrees.get(node.id) ?? 0;
      if (edgesChanged) {
        for (let index = 0; index < 16; index += 1) {
          tickLayout(this.layout, this.layoutEdges, this.selectedId);
        }
      }
      this.syncLabels();
      this.draw();
      return;
    }

    const previous = new Map(this.layout.map((node) => [node.id, node]));
    this.layout = seedLayout(ids, degrees).map((node) => {
      const old = previous.get(node.id);
      if (!old) return node;
      return { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy };
    });
    for (let index = 0; index < WARMUP; index += 1) {
      tickLayout(this.layout, this.layoutEdges, this.selectedId);
    }
    this.rebuildLabels(nodes, degrees);
    this.fit(true);
  }

  setSelected(id: string | null) {
    const changed = this.selectedId !== id;
    this.selectedId = id;
    this.cluster = neighborSet(this.selectedId, this.layoutEdges);
    this.syncLabels();
    this.draw();
    if (changed && id && !this.isInView(id, 0.64)) this.fit(true);
  }

  fit(force = false) {
    if (!this.layout.length) return;
    const focus = this.selectedId
      ? this.layout.filter((node) => this.cluster.has(node.id))
      : this.layout;
    const target = fitView(boundsOf(focus.length ? focus : this.layout), this.width, this.height);
    if (force) {
      this.cameraTarget = target;
      this.animatingCamera = true;
    } else {
      this.camera = target;
      this.cameraTarget = target;
      this.animatingCamera = false;
      this.syncLabels();
      this.draw();
    }
  }

  reset() {
    const nodes = [...this.nodes.values()].map((node) => ({ id: node.id, title: node.title }));
    const edges = this.layoutEdges.map((edge) => ({ source: edge.source, target: edge.target }));
    this.layout = [];
    this.clearLabels();
    this.setGraph(nodes, edges, this.selectedId);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onWindowResize);
    this.host.removeEventListener("pointerdown", this.onPointerDown);
    this.host.removeEventListener("pointerup", this.onPointerUp);
    this.host.removeEventListener("pointermove", this.onPointerMove);
    this.host.removeEventListener("pointerleave", this.onPointerLeave);
    this.host.removeEventListener("dblclick", this.onDoubleClick);
    this.host.removeEventListener("wheel", this.onWheel);
    this.resizeObserver?.disconnect();
    this.clearLabels();
    this.canvas.remove();
    this.labels.remove();
  }

  private bind() {
    this.onWindowResize = this.onWindowResize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onDoubleClick = this.onDoubleClick.bind(this);
    this.onWheel = this.onWheel.bind(this);
    window.addEventListener("resize", this.onWindowResize);
    this.host.addEventListener("pointerdown", this.onPointerDown);
    this.host.addEventListener("pointerup", this.onPointerUp);
    this.host.addEventListener("pointermove", this.onPointerMove);
    this.host.addEventListener("pointerleave", this.onPointerLeave);
    this.host.addEventListener("dblclick", this.onDoubleClick);
    this.host.addEventListener("wheel", this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
  }

  private onWindowResize() {
    this.resize();
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const becameReady = !this.hasSized && width > 8 && height > 8;
    this.hasSized = width > 8 && height > 8;
    this.width = width;
    this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (becameReady && this.layout.length) this.fit(false);
    else {
      this.syncLabels();
      this.draw();
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (typeof document !== "undefined" && document.hidden) return;
    let dirty = false;
    if (this.layout.length && !this.draggingId && layoutEnergy(this.layout) > 0.35) {
      tickLayout(this.layout, this.layoutEdges, this.selectedId);
      dirty = true;
    }
    if (this.animatingCamera) {
      this.camera.x += (this.cameraTarget.x - this.camera.x) * CAMERA_EASE;
      this.camera.y += (this.cameraTarget.y - this.camera.y) * CAMERA_EASE;
      this.camera.scale += (this.cameraTarget.scale - this.camera.scale) * CAMERA_EASE;
      if (
        Math.abs(this.camera.x - this.cameraTarget.x) < 0.4 &&
        Math.abs(this.camera.y - this.cameraTarget.y) < 0.4 &&
        Math.abs(this.camera.scale - this.cameraTarget.scale) < 0.004
      ) {
        this.camera = { ...this.cameraTarget };
        this.animatingCamera = false;
      }
      dirty = true;
    }
    if (dirty) this.syncLabels();
    if (dirty || this.layoutEdges.length) this.draw();
  };

  private kindOf(id: string): NodeKind {
    if (id === this.selectedId) return "selected";
    if (this.selectedId && this.cluster.has(id)) return "neighbor";
    if (!this.selectedId) return "plain";
    return "muted";
  }

  private rebuildLabels(nodes: GraphSceneNode[], degrees: Map<string, number>) {
    this.clearLabels();
    for (const node of nodes) {
      const label = document.createElement("button");
      label.type = "button";
      label.className = "note-graph-label";
      label.dataset.graphNode = node.id;
      label.textContent = node.title;
      label.addEventListener("pointerdown", (event) => event.stopPropagation());
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        this.handlers.onSelect(node.id);
      });
      label.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.handlers.onOpen(node.id);
      });
      this.labels.append(label);
      this.nodes.set(node.id, {
        id: node.id,
        title: node.title,
        degree: degrees.get(node.id) ?? 0,
        label,
      });
    }
    this.syncLabels();
  }

  private clearLabels() {
    this.labels.replaceChildren();
    this.nodes.clear();
  }

  private worldToScreen(x: number, y: number) {
    return {
      x: (x - this.camera.x) * this.camera.scale + this.width / 2,
      y: (y - this.camera.y) * this.camera.scale + this.height / 2,
    };
  }

  private screenToWorld(x: number, y: number) {
    return {
      x: (x - this.width / 2) / this.camera.scale + this.camera.x,
      y: (y - this.height / 2) / this.camera.scale + this.camera.y,
    };
  }

  private isInView(id: string, inset = 0.7) {
    const node = this.layout.find((item) => item.id === id);
    if (!node) return false;
    const point = this.worldToScreen(node.x, node.y);
    const mx = this.width * (1 - inset) * 0.5;
    const my = this.height * (1 - inset) * 0.5;
    return point.x > mx && point.x < this.width - mx && point.y > my && point.y < this.height - my;
  }

  private syncLabels() {
    const showMuted = this.layout.length < 48 || this.camera.scale > 0.95;
    for (const node of this.layout) {
      const view = this.nodes.get(node.id);
      if (!view) continue;
      const kind = this.kindOf(node.id);
      const point = this.worldToScreen(node.x, node.y);
      const radius = nodeRadius(kind) * this.camera.scale;
      view.label.classList.toggle("is-active", kind === "selected");
      view.label.classList.toggle("is-neighbor", kind === "neighbor");
      view.label.classList.toggle("is-muted", kind === "muted");
      view.label.hidden = kind === "muted" && !showMuted;
      view.label.style.transform = `translate(${point.x}px, ${point.y + radius + 7}px) translate(-50%, 0)`;
    }
  }

  private reducedMotion() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const reduced = this.reducedMotion();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.camera.scale, this.camera.scale);
    ctx.translate(-this.camera.x, -this.camera.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const byId = new Map(this.layout.map((node) => [node.id, node]));
    const inactive: LayoutEdge[] = [];
    const active: LayoutEdge[] = [];
    for (const edge of this.layoutEdges) {
      const linked =
        Boolean(this.selectedId) &&
        (edge.source === this.selectedId || edge.target === this.selectedId);
      (linked ? active : inactive).push(edge);
    }

    for (const edge of inactive) this.strokeEdge(ctx, byId, edge, { active: false, now, reduced });
    for (const edge of active) this.strokeEdge(ctx, byId, edge, { active: true, now, reduced });

    const order: NodeKind[] = ["muted", "plain", "neighbor", "selected"];
    for (const kind of order) {
      for (const node of this.layout) {
        if (this.kindOf(node.id) !== kind) continue;
        this.drawNode(ctx, node, kind, node.id === this.hoverId);
      }
    }
    ctx.restore();
  }

  private strokeEdge(
    ctx: CanvasRenderingContext2D,
    byId: Map<string, LayoutNode>,
    edge: LayoutEdge,
    opts: { active: boolean; now: number; reduced: boolean },
  ) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;
    const ux = dx / dist;
    const uy = dy / dist;
    const r1 = nodeRadius(this.kindOf(source.id));
    const r2 = nodeRadius(this.kindOf(target.id));
    const x1 = source.x + ux * (r1 + 0.6);
    const y1 = source.y + uy * (r1 + 0.6);
    const x2 = target.x - ux * (r2 + (opts.active ? 1.2 : 0.6));
    const y2 = target.y - uy * (r2 + (opts.active ? 1.2 : 0.6));
    const scale = this.camera.scale;
    const inv = 1 / Math.max(scale, 0.001);
    const baseAlpha = opts.active
      ? 0.36
      : this.selectedId
        ? this.theme.dark
          ? 0.14
          : 0.1
        : this.theme.dark
          ? 0.32
          : 0.28;

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(this.theme.accent, baseAlpha);
    ctx.lineWidth = (opts.active ? 1.7 : 1.05) * inv;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (!opts.reduced) {
      ctx.setLineDash(opts.active ? [6.5 * inv, 9 * inv] : [4 * inv, 13 * inv]);
      ctx.lineDashOffset = flowDashOffset(opts.now, opts.active ? 40 : 18, scale);
      ctx.strokeStyle = rgba(this.theme.accent, opts.active ? 0.95 : 0.22);
      ctx.lineWidth = (opts.active ? 1.95 : 1.12) * inv;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      const count = opts.active ? 2 : 1;
      const period = opts.active ? 1680 : 2600;
      const phase = edgePhase(edge.source, edge.target);
      for (let index = 0; index < count; index += 1) {
        const t = flowParticleT(opts.now, period, phase + index / count);
        const fade = Math.min(t, 1 - t, 0.14) / 0.14;
        if (fade <= 0.03) continue;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const radius = (opts.active ? 2.4 : 1.45) * inv;
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = rgba(this.theme.accent, (opts.active ? 0.22 : 0.08) * fade);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = rgba(this.theme.accentContrast, (opts.active ? 0.96 : 0.4) * fade);
        ctx.fill();
      }
    }

    if (!opts.active) return;
    const size = 7 * inv;
    const angle = Math.atan2(uy, ux);
    ctx.fillStyle = rgba(this.theme.accent, 0.92);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - size * Math.cos(angle - 0.46), y2 - size * Math.sin(angle - 0.46));
    ctx.lineTo(x2 - size * Math.cos(angle + 0.46), y2 - size * Math.sin(angle + 0.46));
    ctx.closePath();
    ctx.fill();
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: LayoutNode, kind: NodeKind, hover: boolean) {
    const radius = nodeRadius(kind) * (hover && kind !== "selected" ? 1.06 : 1);
    if (kind === "selected") {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = rgba(this.theme.accent, this.theme.dark ? 0.18 : 0.14);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    if (kind === "selected" || kind === "neighbor") {
      ctx.fillStyle = this.theme.accent;
    } else if (kind === "plain") {
      ctx.fillStyle = rgba(this.theme.accent, 0.88);
    } else {
      ctx.fillStyle = rgba(this.theme.accent, this.theme.dark ? 0.22 : 0.15);
    }
    ctx.fill();
    if (kind === "muted") return;
    this.drawGlyph(ctx, node.x, node.y, radius, this.theme.accentContrast);
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
  ) {
    const w = radius * 0.86;
    const h = radius * 1.02;
    const left = x - w / 2;
    const top = y - h / 2;
    const corner = Math.max(1.15, radius * 0.16);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.05, radius * 0.1);
    ctx.beginPath();
    ctx.moveTo(left + corner, top);
    ctx.lineTo(left + w - corner, top);
    ctx.quadraticCurveTo(left + w, top, left + w, top + corner);
    ctx.lineTo(left + w, top + h - corner);
    ctx.quadraticCurveTo(left + w, top + h, left + w - corner, top + h);
    ctx.lineTo(left + corner, top + h);
    ctx.quadraticCurveTo(left, top + h, left, top + h - corner);
    ctx.lineTo(left, top + corner);
    ctx.quadraticCurveTo(left, top, left + corner, top);
    ctx.closePath();
    ctx.stroke();
    const inset = w * 0.22;
    for (const t of [0.38, 0.55, 0.72]) {
      ctx.beginPath();
      ctx.moveTo(left + inset, top + h * t);
      ctx.lineTo(left + w - inset, top + h * t);
      ctx.stroke();
    }
    ctx.restore();
  }

  private pick(event: { clientX: number; clientY: number; target: EventTarget | null }) {
    const fromLabel = (event.target as HTMLElement | null)?.closest?.("[data-graph-node]");
    if (fromLabel instanceof HTMLElement && fromLabel.dataset.graphNode) return fromLabel.dataset.graphNode;
    const rect = this.host.getBoundingClientRect();
    const world = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    let best: string | null = null;
    let bestDist = Infinity;
    for (const node of this.layout) {
      const slop = 8 / this.camera.scale;
      const hit = nodeRadius(this.kindOf(node.id)) + slop;
      const dist = Math.hypot(node.x - world.x, node.y - world.y);
      if (dist <= hit && dist < bestDist) {
        best = node.id;
        bestDist = dist;
      }
    }
    return best;
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.panLast = { x: event.clientX, y: event.clientY };
    this.dragged = false;
    const id = this.pick(event);
    this.draggingId = id;
    this.panning = !id;
    try {
      this.host.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom */
    }
  }

  private onPointerMove(event: PointerEvent) {
    const id = this.pick(event);
    if (!this.panning && !this.draggingId && id !== this.hoverId) {
      this.hoverId = id;
      this.host.style.cursor = id ? "pointer" : "grab";
      this.draw();
    }
    if (!this.panning && !this.draggingId) return;
    const dx = event.clientX - this.panLast.x;
    const dy = event.clientY - this.panLast.y;
    this.panLast = { x: event.clientX, y: event.clientY };
    if (Math.hypot(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y) > POINTER_CLICK_PX) {
      this.dragged = true;
    }
    if (this.panning) {
      this.animatingCamera = false;
      this.camera.x -= dx / this.camera.scale;
      this.camera.y -= dy / this.camera.scale;
      this.cameraTarget = { ...this.camera };
      this.host.style.cursor = "grabbing";
      this.syncLabels();
      this.draw();
      return;
    }
    if (this.draggingId) {
      const node = this.layout.find((item) => item.id === this.draggingId);
      if (!node) return;
      const rect = this.host.getBoundingClientRect();
      const world = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      node.x = world.x;
      node.y = world.y;
      node.vx = 0;
      node.vy = 0;
      this.host.style.cursor = "grabbing";
      this.syncLabels();
      this.draw();
    }
  }

  private onPointerUp(event: PointerEvent) {
    const dragged = this.dragged;
    const id = this.draggingId || this.pick(event);
    this.panning = false;
    this.draggingId = null;
    this.host.style.cursor = this.pick(event) ? "pointer" : "grab";
    if (!dragged && id) this.handlers.onSelect(id);
  }

  private onPointerLeave() {
    this.panning = false;
    this.draggingId = null;
    if (this.hoverId) {
      this.hoverId = null;
      this.draw();
    }
    this.host.style.cursor = "grab";
  }

  private onDoubleClick(event: MouseEvent) {
    const id = this.pick(event);
    if (id) this.handlers.onOpen(id);
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault();
    const rect = this.host.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const world = this.screenToWorld(sx, sy);
    const next = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, this.camera.scale * (event.deltaY > 0 ? 0.92 : 1.08)),
    );
    this.animatingCamera = false;
    this.camera.scale = next;
    this.camera.x = world.x - (sx - this.width / 2) / next;
    this.camera.y = world.y - (sy - this.height / 2) / next;
    this.cameraTarget = { ...this.camera };
    this.syncLabels();
    this.draw();
  }
}
