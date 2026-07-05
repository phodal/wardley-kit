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

const BASIC_MAP = `title Basic Map
size [960, 640]
component User [0.9, 0.2]
component Need [0.7, 0.45]
component Capability [0.5, 0.62] (build)
component Runtime [0.3, 0.82] (buy)
User->Need
Need->Capability
Capability->Runtime`;

const GRAPH_MAP = `title Reachable Map
size [1120, 760]
component Citizen Builders [0.95, 0.50]
component Idea to Live App [0.84, 0.50]
component Prompt to App Builder [0.68, 0.58] (buy)
component Backend Services [0.40, 0.82] (outsource)
component Model Gateway [0.23, 0.69] (buy)
component Foundation Models [0.12, 0.82] (outsource)
Citizen Builders->Idea to Live App
Idea to Live App->Prompt to App Builder
Prompt to App Builder->Backend Services
Backend Services->Model Gateway
Model Gateway->Foundation Models`;

const PLATFORM_MAP = `title Platform Map
size [960, 640]
component User Need [0.95, 0.18]
component Product Experience [0.82, 0.42] (build)
component API Gateway [0.66, 0.58]
component Identity [0.57, 0.70] (buy)
User Need->Product Experience
Product Experience->API Gateway
API Gateway->Identity
evolve Product Experience 0.68 (market, build)`;

const DENSE_MAP = `title Dense Map
size [960, 640]
${Array.from({ length: 30 }, (_, index) => {
  const visibility = (0.92 - (index % 10) * 0.07).toFixed(2);
  const evolution = (0.12 + Math.floor(index / 10) * 0.22 + (index % 3) * 0.03).toFixed(2);
  return `component C${index + 1} [${evolution}, ${visibility}]`;
}).join("\n")}
${Array.from({ length: 45 }, (_, index) => `C${index % 30 + 1}->C${(index + 1) % 30 + 1}`).join("\n")}`;

describe("wardley-kit", () => {
  it("parses and renders a Wardley map", () => {
    const map = parseWardleyMap(BASIC_MAP);
    const svg = renderWardleyMapSvg(map, { notation: "clean" });

    expect(map.title).toBe("Basic Map");
    expect(map.components.length).toBe(4);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Basic Map");
  });

  it("reports parse diagnostics for unresolved links", () => {
    const validation = validateWardleyMap(`title Broken\ncomponent User [0.9, 0.2]\nUser->Missing`);

    expect(validation.valid).toBe(false);
    expect(validation.diagnostics[0]?.code).toBe("S4WARDLEY_UNKNOWN_COMPONENT");
  });

  it("exposes graph paths for reachable context", () => {
    const map = parseWardleyMap(GRAPH_MAP);
    const graph = buildWardleyGraph(map);
    const focus = graph.nodesByName.get("citizen builders");
    const result = wardleyGraphPaths(graph, focus?.id ?? "", "outgoing", { maxPaths: 8 });

    expect(focus?.name).toBe("Citizen Builders");
    expect(result.paths.some((path) => path.componentNames.includes("Foundation Models"))).toBe(true);
  });

  it("summarizes as a generic visualization graph", () => {
    const map = parseWardleyMap(PLATFORM_MAP);
    const graph = wardleyToVisualizationGraph(map);

    expect(graph.title).toBe(map.title);
    expect(graph.nodes.length).toBe(map.components.length);
    expect(graph.edges.length).toBe(map.links.length + map.evolutions.length);
  });

  it("keeps dense maps readable through auto-scale", () => {
    const map = parseWardleyMap(DENSE_MAP);
    const scale = wardleyAutoScaleFactor(map);
    const layout = analyzeWardleyLayout(map, { autoScale: true });

    expect(scale).toBeGreaterThan(1);
    expect(layout.width).toBeGreaterThan(map.size.width);
  });
});
