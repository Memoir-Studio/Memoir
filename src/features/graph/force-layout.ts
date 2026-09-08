export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
};

export type LayoutEdge = {
  source: string;
  target: string;
};

const PHI = Math.PI * (3 - Math.sqrt(5));

export function seedLayout(ids: string[], degrees: Map<string, number>): LayoutNode[] {
  const count = Math.max(ids.length, 1);
  const radius = 96 + Math.sqrt(count) * 82;
  return ids.map((id, index) => {
    if (count === 1) {
      return { id, x: 0, y: 0, vx: 0, vy: 0, degree: degrees.get(id) ?? 0 };
    }
    const theta = index * PHI;
    const ring = Math.sqrt((index + 0.5) / count) * radius;
    return {
      id,
      x: Math.cos(theta) * ring,
      y: Math.sin(theta) * ring,
      vx: 0,
      vy: 0,
      degree: degrees.get(id) ?? 0,
    } satisfies LayoutNode;
  });
}

export function neighborSet(id: string | null, edges: LayoutEdge[]) {
  const next = new Set<string>();
  if (!id) return next;
  next.add(id);
  for (const edge of edges) {
    if (edge.source === id) next.add(edge.target);
    if (edge.target === id) next.add(edge.source);
  }
  return next;
}

export function tickLayout(nodes: LayoutNode[], edges: LayoutEdge[], selectedId: string | null = null) {
  const count = nodes.length;
  if (!count) return;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const charge = count > 80 ? 2600 : count > 20 ? 5000 : 6400;
  const rest = count > 80 ? 90 : count > 12 ? 116 : 128;

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = charge / (dist * dist);
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }
  }

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const pull = (dist - rest) * 0.055;
    const fx = (dx / dist) * pull;
    const fy = (dy / dist) * pull;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  for (const node of nodes) {
    node.vx += -node.x * 0.008;
    node.vy += -node.y * 0.008;
    node.vx *= 0.82;
    node.vy *= 0.82;
    node.x += node.vx;
    node.y += node.vy;
  }

  if (selectedId) tickFocus(byId, edges, selectedId);
}

function tickFocus(byId: Map<string, LayoutNode>, edges: LayoutEdge[], selectedId: string) {
  const selected = byId.get(selectedId);
  if (!selected) return;
  selected.vx += -selected.x * 0.03;
  selected.vy += -selected.y * 0.03;
  selected.x += -selected.x * 0.02;
  selected.y += -selected.y * 0.02;

  const neighbors = [...neighborSet(selectedId, edges)].filter((id) => id !== selectedId).sort();
  if (!neighbors.length) return;
  const radius = 122 + Math.min(36, neighbors.length * 3.5);
  neighbors.forEach((id, index) => {
    const node = byId.get(id);
    if (!node) return;
    const angle = neighbors.length === 1 ? 0 : -Math.PI / 2 + (index / neighbors.length) * Math.PI * 2;
    const tx = selected.x + Math.cos(angle) * radius;
    const ty = selected.y + Math.sin(angle) * radius;
    node.vx += (tx - node.x) * 0.05;
    node.vy += (ty - node.y) * 0.05;
    node.x += (tx - node.x) * 0.04;
    node.y += (ty - node.y) * 0.04;
  });
}

export function degreesFromEdges(ids: string[], edges: LayoutEdge[]) {
  const degrees = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
}

export function layoutEnergy(nodes: LayoutNode[]) {
  return nodes.reduce((sum, node) => sum + node.vx ** 2 + node.vy ** 2, 0);
}
