import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeWardleyLayout,
  buildWardleyGraph,
  parseWardleyMap,
  renderWardleyMapSvg,
  validateWardleyMap,
  wardleyAutoScaleFactor,
  wardleyGraphPaths,
  wardleyToVisualizationGraph
} from "../src/index.js";

function readExample(name: string): string {
  return readFileSync(resolve("examples", name), "utf8");
}

describe("wardley-kit", () => {
  it("parses and renders a Wardley map", () => {
    const map = parseWardleyMap(readExample("tea-shop.owm"));
    const svg = renderWardleyMapSvg(map, { notation: "clean" });

    expect(map.title).toBe("Tea Shop");
    expect(map.components.length).toBeGreaterThan(5);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Tea Shop");
  });

  it("reports parse diagnostics for unresolved links", () => {
    const validation = validateWardleyMap(`title Broken\ncomponent User [0.9, 0.2]\nUser->Missing`);

    expect(validation.valid).toBe(false);
    expect(validation.diagnostics[0]?.code).toBe("S4WARDLEY_UNKNOWN_COMPONENT");
  });

  it("exposes graph paths for reachable context", () => {
    const map = parseWardleyMap(readExample("ai-builder-app.owm"));
    const graph = buildWardleyGraph(map);
    const focus = graph.nodesByName.get("citizen builders");
    const result = wardleyGraphPaths(graph, focus?.id ?? "", "outgoing", { maxPaths: 8 });

    expect(focus?.name).toBe("Citizen Builders");
    expect(result.paths.some((path) => path.componentNames.includes("Foundation Models"))).toBe(true);
  });

  it("summarizes as a generic visualization graph", () => {
    const map = parseWardleyMap(readExample("platform-strategy.owm"));
    const graph = wardleyToVisualizationGraph(map);

    expect(graph.title).toBe(map.title);
    expect(graph.nodes.length).toBe(map.components.length);
    expect(graph.edges.length).toBe(map.links.length + map.evolutions.length);
  });

  it("keeps dense maps readable through auto-scale", () => {
    const map = parseWardleyMap(readExample("ai-builder-app.owm"));
    const scale = wardleyAutoScaleFactor(map);
    const layout = analyzeWardleyLayout(map, { autoScale: true });

    expect(scale).toBeGreaterThan(1);
    expect(layout.width).toBeGreaterThan(map.size.width);
  });
});
