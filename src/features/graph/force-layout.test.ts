import { describe, expect, it } from "vitest";
import { degreesFromEdges, layoutEnergy, neighborSet, seedLayout, tickLayout } from "./force-layout";

describe("force layout", () => {
  it("pulls linked notes closer over ticks", () => {
    const ids = ["a", "b", "c"];
    const edges = [{ source: "a", target: "b" }];
    const degrees = degreesFromEdges(ids, edges);
    const nodes = seedLayout(ids, degrees);
    for (let index = 0; index < 80; index += 1) tickLayout(nodes, edges);
    const linked = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
    expect(linked).toBeGreaterThan(40);
    expect(linked).toBeLessThan(240);
    expect(layoutEnergy(nodes)).toBeLessThan(80);
  });

  it("places a small graph on a 2D disc", () => {
    const nodes = seedLayout(
      ["a", "b"],
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
    );
    expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeGreaterThan(8);
  });

  it("orbits neighbors around the selected note", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
    ];
    const nodes = seedLayout(ids, degreesFromEdges(ids, edges));
    for (let index = 0; index < 120; index += 1) tickLayout(nodes, edges, "a");
    const a = nodes.find((node) => node.id === "a")!;
    const b = nodes.find((node) => node.id === "b")!;
    const c = nodes.find((node) => node.id === "c")!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(70);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(240);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(70);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(240);
    expect(neighborSet("a", edges).size).toBe(3);
  });
});
