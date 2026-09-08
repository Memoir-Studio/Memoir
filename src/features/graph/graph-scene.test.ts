import { describe, expect, it } from "vitest";
import { boundsOf, edgePhase, fitView, flowDashOffset, flowParticleT, nodeRadius } from "./graph-scene";

describe("graph camera and nodes", () => {
  it("keeps note dots in a compact Feishu-like size range", () => {
    expect(nodeRadius("muted")).toBeLessThan(10);
    expect(nodeRadius("plain")).toBeLessThan(12);
    expect(nodeRadius("neighbor")).toBeLessThan(14);
    expect(nodeRadius("selected")).toBeLessThan(18);
    expect(nodeRadius("selected")).toBeGreaterThan(nodeRadius("neighbor"));
  });

  it("fits a small graph with padding instead of filling the frame", () => {
    const view = fitView(boundsOf([{ x: -64, y: 0 }, { x: 64, y: 0 }]), 1000, 700);
    expect(view.scale).toBeLessThanOrEqual(1.38);
    expect(view.scale).toBeGreaterThan(0.5);
    expect(view.x).toBeCloseTo(0);
    expect(view.y).toBeCloseTo(0);
  });

  it("advances dash offset and particle progress along an edge", () => {
    const later = flowDashOffset(2000, 40, 1);
    const earlier = flowDashOffset(500, 40, 1);
    expect(later).toBeLessThan(earlier);
    expect(flowParticleT(0, 1000, 0)).toBeCloseTo(0);
    expect(flowParticleT(250, 1000, 0)).toBeCloseTo(0.25);
    expect(flowParticleT(1000, 1000, 0)).toBeCloseTo(0);
    expect(flowParticleT(250, 1000, 0.5)).toBeCloseTo(0.75);
    const phase = edgePhase("one.md", "two.md");
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(edgePhase("one.md", "two.md")).toBe(phase);
    expect(edgePhase("two.md", "one.md")).not.toBe(phase);
  });
});
