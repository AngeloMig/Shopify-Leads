import { describe, it, expect } from "vitest";
import {
  buildNetwork,
  neuronSizeTiers,
} from "../src/components/research-network-model";
describe("Dense interactive neural map", () => {
  it("keeps the visual topology within the rendering budget and covers all four worker regions", () => {
    const graph = buildNetwork();
    expect(graph.points).toHaveLength(10000);
    expect(graph.edges.length).toBeGreaterThan(25000);
    expect(graph.edges.length).toBeLessThan(40000);
    expect(new Set(graph.points.map((p) => p.cluster))).toEqual(
      new Set([0, 1, 2, 3]),
    );
    expect(graph.points.filter((p) => p.anchor)).toHaveLength(4);
    expect(graph.points.every((p) => p.position.every(Number.isFinite))).toBe(
      true,
    );
  });
  it("has no duplicate or invalid synapses and no isolated neurons", () => {
    const graph = buildNetwork(),
      pairs = new Set<string>(),
      connected = new Set<number>();
    for (const edge of graph.edges) {
      expect(edge.a).not.toBe(edge.b);
      expect(graph.points[edge.a].position).toEqual(edge.from);
      expect(graph.points[edge.b].position).toEqual(edge.to);
      const pair = [edge.a, edge.b].sort((a, b) => a - b).join(":");
      expect(pairs.has(pair)).toBe(false);
      pairs.add(pair);
      connected.add(edge.a);
      connected.add(edge.b);
    }
    expect(connected.size).toBe(graph.points.length);
  });
  it("keeps all ten thousand neurons connected through bounded local pathways", () => {
    const graph = buildNetwork();
    const links = graph.points.map(() => [] as number[]);
    graph.edges.forEach((e) => {
      links[e.a].push(e.b);
      links[e.b].push(e.a);
    });
    const visited = new Set([0]),
      queue = [0];
    for (let i = 0; i < queue.length; i++)
      for (const next of links[queue[i]])
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
    expect(visited.size).toBe(10000);
    const local = graph.edges.filter(
      (e) => Math.hypot(...e.from.map((v, k) => v - e.to[k])) < 0.6,
    );
    expect(local.length / graph.edges.length).toBeGreaterThan(0.98);
  });
  it("supports lighter density choices without changing the four semantic anchors", () => {
    for (const count of [2000, 5000]) {
      const graph = buildNetwork(count);
      expect(graph.points).toHaveLength(count);
      expect(graph.edges.length).toBeLessThan(count * 4);
      expect(graph.points.slice(0, 4).map((p) => p.position)).toEqual(
        buildNetwork(8)
          .points.slice(0, 4)
          .map((p) => p.position),
      );
    }
  });
  it("scatters ten stable size tiers with many more small neurons than large hubs", () => {
    const graph = buildNetwork();
    const counts = neuronSizeTiers.map(
      (tier) => graph.points.filter((point) => point.size === tier.size).length,
    );
    expect(new Set(graph.points.map((point) => point.size)).size).toBe(10);
    counts.forEach((count, i) => {
      expect(count).toBeGreaterThan(0);
      if (i) expect(count).toBeLessThan(counts[i - 1]);
    });
    expect(counts[0] + counts[1] + counts[2]).toBeGreaterThan(7400);
    expect(counts[9]).toBeLessThan(100);
    expect(buildNetwork(2000).points.map((point) => point.size)).toEqual(
      graph.points.slice(0, 2000).map((point) => point.size),
    );
  });
});
