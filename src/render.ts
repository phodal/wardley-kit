import type {
  WardleyAnnotation,
  WardleyAttitudeArea,
  WardleyComponent,
  WardleyLink,
  WardleyMap,
  WardleyMarker,
  WardleyPipeline,
  WardleyRenderOptions
} from "./types.js";
import { quadraticRouteSegments, routeQuadraticSegment, type RouteObstacle } from "./path-routing.js";
import { buildWardleyGraph, type WardleyGraph, type WardleyGraphEdge } from "./graph.js";
import { compactText } from "./text.js";
import { placeTextBoxes, type PlacedTextBox, type TextPlacementBox, type TextPlacementSegment } from "./text-placement.js";
import {
  layoutCalloutText,
  layoutComponentLabelText,
  layoutEdgeLabelText,
  layoutMarkerLabelText,
  layoutWardleyTitleText
} from "./text-layout.js";
import { resolveWardleyViewport } from "./viewport.js";

const MARGIN = { top: 108, right: 48, bottom: 76, left: 96 };
const NODE_RADIUS = 7;
const CLEAN_AXIS_STAGES = [
  { at: 0, label: "Genesis" },
  { at: 0.25, label: "Custom" },
  { at: 0.5, label: "Product (+rental)" },
  { at: 0.75, label: "Commodity (+utility)" }
] as const;
const SKETCH_AXIS_STAGES = [
  { at: 0, label: "Genesis" },
  { at: 0.25, label: "Custom Built" },
  { at: 0.5, label: "Product" },
  { at: 0.75, label: "Commodity\n/Utility" }
] as const;

interface RenderPoint {
  readonly x: number;
  readonly y: number;
}

interface SketchCallout {
  readonly id: string;
  readonly kind: "annotation" | "note";
  readonly text: string;
  readonly color: string;
  readonly point: RenderPoint;
  readonly annotation?: WardleyAnnotation | undefined;
}

interface CleanCallout {
  readonly id: string;
  readonly kind: "annotation" | "note";
  readonly text: string;
  readonly color: string;
  readonly point: RenderPoint;
  readonly annotation?: WardleyAnnotation | undefined;
}

interface CleanCalloutPlacement extends CleanCallout {
  readonly box: PlacedTextBox;
}

interface SketchCalloutPlacement extends SketchCallout {
  readonly box: PlacedTextBox;
  readonly textPoint: RenderPoint;
  readonly leaderPoint: RenderPoint;
}

interface LabelAvoidanceSegment extends TextPlacementSegment {
  readonly sourceComponentId?: string | undefined;
  readonly targetComponentId?: string | undefined;
}

interface ComponentLabelPlacement {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly textX: number;
  readonly textY: number;
  readonly fontSize: number;
  readonly lineHeight: number;
}

interface MarkerLabelPlacement {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly textX: number;
  readonly textY: number;
  readonly glyphX: number;
  readonly glyphY: number;
  readonly fontSize: number;
  readonly lineHeight: number;
}

export function renderWardleyMapSvg(map: WardleyMap, options: WardleyRenderOptions = {}): string {
  const { width, height } = resolveWardleyViewport(map, options);
  const notation = resolveNotation(map, options);
  if (notation === "sketch") {
    return renderSketchWardleyMapSvg(map, width, height);
  }
  const dark = options.theme === "dark";
  const colors = {
    background: dark ? "#18181b" : "#ffffff",
    text: dark ? "#f4f4f5" : "#111827",
    muted: dark ? "#a1a1aa" : "#64748b",
    grid: dark ? "#3f3f46" : "#e2e8f0",
    axis: dark ? "#71717a" : "#475569",
    component: dark ? "#38bdf8" : "#0369a1",
    market: dark ? "#fbbf24" : "#b45309",
    ecosystem: dark ? "#34d399" : "#047857",
    pipeline: dark ? "#f59e0b" : "#d97706",
    annotation: dark ? "#facc15" : "#ca8a04",
    accelerator: dark ? "#86efac" : "#16a34a",
    deaccelerator: dark ? "#fca5a5" : "#dc2626",
    note: dark ? "#a78bfa" : "#7c3aed",
    edge: dark ? "#d4d4d8" : "#334155"
  };
  const graph = buildWardleyGraph(map);
  const byName = graphComponentsByName(graph);
  const nodes = map.components.map((component) => {
    const point = pointFor(component.visibility, component.evolution, width, height);
    return { component, point };
  });
  const labelPlacements = placeComponentLabels(map, width, height, "clean", graph);
  const componentObstacles = componentRouteObstacles(map, width, height, "clean", labelPlacements);
  const labelSegments = labelAvoidanceSegments(map, width, height, "clean", graph);
  const markerLabelPlacements = placeMarkerLabels(map, width, height, "clean", componentObstacles, labelSegments);
  const markerObstacles = markerRouteObstacles(map, width, height, markerLabelPlacements);
  const calloutPlacements = placeCleanTextCallouts(map, width, height, colors, [...componentObstacles, ...markerObstacles], labelSegments);
  const routeObstacles = [
    ...componentObstacles,
    ...markerObstacles,
    ...calloutRouteObstacles(calloutPlacements)
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(map.title)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="max-width: 100%; height: auto; display: block; background: ${colors.background};">
  <defs>
    <marker id="wardley-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto-start-reverse">
      <path d="M0,0 L0,6 L8,3 z" fill="${colors.edge}" />
    </marker>
    <marker id="wardley-evolve-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="${colors.component}" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${colors.background}" />
  ${renderAxes(map, width, height, colors)}
  ${map.attitudes.map((area) => renderCleanAttitudeArea(area, width, height, colors)).join("\n  ")}
  ${map.pipelines.map((pipeline) => renderPipeline(pipeline, byName, map.components, width, height, colors.pipeline)).join("\n  ")}
  ${graph.linkEdges.map((edge) => renderLinkEdge(edge, graph, width, height, colors, routeObstacles)).join("\n  ")}
  ${graph.evolutionEdges.map((edge) => renderEvolutionEdge(edge, graph, byName, width, height, colors.component)).join("\n  ")}
  ${map.markers.map((marker) => renderMarker(marker, width, height, colors, markerLabelPlacements.get(marker.id))).join("\n  ")}
  ${nodes.map(({ component, point }) => renderComponent(component, point, colors, labelPlacements.get(component.id))).join("\n  ")}
  ${renderCleanTextCallouts(calloutPlacements, width, height)}
</svg>`;
}

function resolveNotation(map: WardleyMap, options: WardleyRenderOptions): "clean" | "sketch" {
  if (options.notation) {
    return options.notation;
  }
  const style = map.style?.toLowerCase() ?? "";
  return style.includes("clean") || style.includes("formal") || style.includes("technical") ? "clean" : "sketch";
}

function graphComponentsByName(graph: WardleyGraph): Map<string, WardleyComponent> {
  return new Map([...graph.nodesByName.entries()].map(([name, node]) => [name, node.component]));
}

function edgeOrdinal(edge: WardleyGraphEdge): number {
  const match = /-(\d+)$/u.exec(edge.id);
  return match ? Number.parseInt(match[1]!, 10) - 1 : 0;
}

function renderSketchWardleyMapSvg(map: WardleyMap, width: number, height: number): string {
  const colors = {
    background: "#fffefd",
    paper: "#fffefd",
    text: "#262626",
    muted: "#3f3f46",
    grid: "#d1d5db",
    axis: "#18181b",
    component: "#225d99",
    market: "#96651b",
    ecosystem: "#24765a",
    componentLight: "#dceaff",
    areaStroke: "#8ca6ca",
    pipeline: "#d97706",
    annotation: "#ca8a04",
    accelerator: "#18824f",
    deaccelerator: "#b91c1c",
    note: "#27272a",
    edge: "#202020"
  };
  const graph = buildWardleyGraph(map);
  const byName = graphComponentsByName(graph);
  const nodes = map.components.map((component) => {
    const point = pointFor(component.visibility, component.evolution, width, height);
    return { component, point };
  });
  const labelPlacements = placeComponentLabels(map, width, height, "sketch", graph);
  const componentObstacles = componentRouteObstacles(map, width, height, "sketch", labelPlacements);
  const labelSegments = labelAvoidanceSegments(map, width, height, "sketch", graph);
  const markerLabelPlacements = placeMarkerLabels(map, width, height, "sketch", componentObstacles, labelSegments);
  const markerObstacles = markerRouteObstacles(map, width, height, markerLabelPlacements);
  const calloutPlacements = placeSketchTextCallouts(map, width, height, colors, [...componentObstacles, ...markerObstacles], labelSegments);
  const routeObstacles = [
    ...componentObstacles,
    ...markerObstacles,
    ...calloutRouteObstacles(calloutPlacements)
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(map.title)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="max-width: 100%; height: auto; display: block; background: ${colors.background};">
  <defs>
    <pattern id="wardley-sketch-area-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(63)">
      <rect width="8" height="8" fill="#eef5ff" fill-opacity="0.64" />
      <line x1="0" y1="0" x2="0" y2="8" stroke="#9fb5d5" stroke-width="1" stroke-opacity="0.65" />
    </pattern>
    <pattern id="wardley-sketch-node-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
      <rect width="5" height="5" fill="${colors.component}" />
      <line x1="0" y1="0" x2="0" y2="5" stroke="#ffffff" stroke-width="0.8" stroke-opacity="0.26" />
    </pattern>
    <marker id="wardley-sketch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto-start-reverse">
      <path d="M1,1 C3,2.4 5.2,3 7,3 C5.2,3.6 3,4.6 1,5" fill="none" stroke="${colors.edge}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${colors.background}" />
  ${renderSketchAxes(map, width, height, colors)}
  ${map.attitudes.map((area, index) => renderSketchAttitudeArea(area, index, width, height, colors)).join("\n  ")}
  ${map.pipelines.map((pipeline) => renderSketchPipeline(pipeline, byName, map.components, width, height, colors)).join("\n  ")}
  ${graph.linkEdges.map((edge) => renderSketchLinkEdge(edge, graph, width, height, colors, routeObstacles)).join("\n  ")}
  ${graph.evolutionEdges.map((edge) => renderSketchEvolutionEdge(edge, graph, width, height, colors.component)).join("\n  ")}
  ${map.markers.map((marker) => renderSketchMarker(marker, width, height, colors, markerLabelPlacements.get(marker.id))).join("\n  ")}
  ${nodes.map(({ component, point }) => renderSketchComponent(component, point, colors, labelPlacements.get(component.id))).join("\n  ")}
  ${renderSketchTextCallouts(calloutPlacements, width, height)}
</svg>`;
}

function renderAxes(map: WardleyMap, width: number, height: number, colors: Record<string, string>): string {
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = MARGIN.top;
  const bottom = height - MARGIN.bottom;
  const stages = axisStagesFor(map, "clean");
  const separators = stages.slice(1).map((stage) => {
    const x = xFor(stage.at, width);
    return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${colors.grid}" stroke-width="1" stroke-dasharray="3 5" />`;
  }).join("\n    ");
  const labels = stages.map((stage) => {
    const x = xFor(stage.at, width);
    return `<text x="${x + 8}" y="${bottom + 34}" fill="${colors.axis}" font-family="Inter, system-ui, sans-serif" font-size="13">${escapeXml(compactText(stage.label, 28))}</text>`;
  }).join("\n    ");
  const yAxis = map.yAxis?.labels;
  const topLabel = yAxis?.[2] ?? yAxis?.[0] ?? "Visible";
  const bottomLabel = yAxis?.[1] ?? "Invisible";
  const title = layoutWardleyTitleText(map.title, "clean").text;
  return `<text x="${left}" y="34" fill="${colors.text}" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="700">${escapeXml(title)}</text>
  <line x1="${left}" y1="${bottom}" x2="${right + 26}" y2="${bottom}" stroke="${colors.axis}" stroke-width="2" stroke-linecap="round" />
  <path d="M${right + 26},${bottom} l-14,-8 m14,8 l-14,8" fill="none" stroke="${colors.axis}" stroke-width="2" stroke-linecap="round" />
  <line x1="${left}" y1="${bottom}" x2="${left}" y2="${top - 24}" stroke="${colors.axis}" stroke-width="2" stroke-linecap="round" />
  <path d="M${left},${top - 24} l-8,14 m8,-14 l8,14" fill="none" stroke="${colors.axis}" stroke-width="2" stroke-linecap="round" />
  <text transform="translate(${left - 60},${(top + bottom) / 2}) rotate(-90)" fill="${colors.axis}" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="700">Value Chain</text>
  <text transform="translate(${left - 36},${top + 16}) rotate(-90)" fill="${colors.axis}" font-family="Inter, system-ui, sans-serif" font-size="13">${escapeXml(topLabel)}</text>
  <text transform="translate(${left - 36},${bottom - 14}) rotate(-90)" fill="${colors.axis}" font-family="Inter, system-ui, sans-serif" font-size="13">${escapeXml(bottomLabel)}</text>
  ${separators}
  ${labels}
  <text x="${right + 20}" y="${bottom + 55}" fill="${colors.axis}" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="750" text-anchor="end">Evolution</text>`;
}

function renderSketchAxes(map: WardleyMap, width: number, height: number, colors: Record<string, string>): string {
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = MARGIN.top;
  const bottom = height - MARGIN.bottom;
  const textColor = colors.text ?? "#262626";
  const stages = axisStagesFor(map, "sketch");
  const verticals = stages.map((stage) => {
    const x = xFor(stage.at, width);
    return `<path d="M${x - 2},${top - 32} C${x + 2},${top + 110} ${x - 3},${bottom - 118} ${x + 1},${bottom}" fill="none" stroke="${colors.grid}" stroke-width="2" stroke-linecap="round" opacity="0.86" />`;
  }).join("\n    ");
  const labels = stages.map((stage) => {
    const x = xFor(stage.at, width);
    return renderSketchAxisLabel(stage.label, x + 8, bottom + 31, textColor, stage.label.includes("\n") ? 18 : 20);
  }).join("\n    ");
  const title = layoutWardleyTitleText(map.title, "sketch").text;
  const titleText = title && title !== "Wardley Map"
    ? `<text x="${left}" y="26" fill="${textColor}" font-family="${sketchFont()}" font-size="28" font-weight="700" paint-order="stroke" stroke="${colors.paper}" stroke-width="5" stroke-linejoin="round">${escapeXml(title)}</text>`
    : "";
  return `${titleText}
  ${verticals}
  <path d="M${left - 10},${bottom} C${left + 210},${bottom + 4} ${right - 162},${bottom - 3} ${right + 25},${bottom}" fill="none" stroke="${colors.axis}" stroke-width="3" stroke-linecap="round" />
  <path d="M${right + 25},${bottom} l-32,-16 m32,16 l-30,18" fill="none" stroke="${colors.axis}" stroke-width="3" stroke-linecap="round" />
  ${labels}
  <text x="${right + 18}" y="${bottom + 62}" fill="${textColor}" font-family="${sketchFont()}" font-size="21" font-weight="700" text-anchor="end" paint-order="stroke" stroke="${colors.paper}" stroke-width="5" stroke-linejoin="round">Evolution</text>`;
}

function renderCleanAttitudeArea(area: WardleyAttitudeArea, width: number, height: number, colors: Record<string, string>): string {
  const box = attitudeBox(area, width, height);
  const fill = area.kind === "pioneers" ? "#dbeafe" : area.kind === "settlers" ? "#e0f2fe" : "#ede9fe";
  return `<rect class="wardley-map-context-layer wardley-attitude-layer" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="16" fill="${fill}" fill-opacity="0.36" stroke="${colors.grid}" stroke-dasharray="7 5" />`;
}

function renderSketchAttitudeArea(area: WardleyAttitudeArea, index: number, width: number, height: number, colors: Record<string, string>): string {
  const box = attitudeBox(area, width, height);
  const path = sketchBlobPath(box.x, box.y, box.width, box.height, index);
  return `<path class="wardley-map-context-layer wardley-attitude-layer" d="${path}" fill="url(#wardley-sketch-area-hatch)" stroke="${colors.areaStroke}" stroke-width="1.6" opacity="0.92" />`;
}

function renderPipeline(
  pipeline: WardleyPipeline,
  byName: Map<string, WardleyComponent>,
  components: readonly WardleyComponent[],
  width: number,
  height: number,
  stroke: string
): string {
  const box = pipelineBox(pipeline, byName, components, width, height, 68);
  if (!box) {
    return "";
  }
  const labelY = Math.max(MARGIN.top + 14, box.y - 8);
  const label = compactText(`${pipeline.name} pipeline`, 32);
  return `<g class="wardley-map-context-layer wardley-pipeline-layer">
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${stroke}" fill-opacity="0.08" stroke="${stroke}" stroke-dasharray="6 5" />
    <text x="${box.x + 8}" y="${labelY}" fill="${stroke}" font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="700">${escapeXml(label)}</text>
  </g>`;
}

function renderSketchPipeline(
  pipeline: WardleyPipeline,
  byName: Map<string, WardleyComponent>,
  components: readonly WardleyComponent[],
  width: number,
  height: number,
  colors: Record<string, string>
): string {
  const box = pipelineBox(pipeline, byName, components, width, height, 72);
  if (!box) {
    return "";
  }
  const label = compactText(`${pipeline.name} pipeline`, 30);
  return `<g class="wardley-map-context-layer wardley-pipeline-layer">
    <path d="${sketchBlobPath(box.x, box.y, box.width, box.height, 3)}" fill="none" stroke="${colors.pipeline}" stroke-width="1.5" stroke-dasharray="7 6" opacity="0.86" />
    <text x="${box.x + 8}" y="${Math.max(MARGIN.top + 16, box.y - 8)}" fill="${colors.pipeline}" font-family="${sketchFont()}" font-size="14" font-weight="700" paint-order="stroke" stroke="${colors.paper}" stroke-width="4" stroke-linejoin="round">${escapeXml(label)}</text>
  </g>`;
}

function pipelineBox(
  pipeline: WardleyPipeline,
  byName: Map<string, WardleyComponent>,
  components: readonly WardleyComponent[],
  width: number,
  height: number,
  fallbackHeight: number
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
  const component = byName.get(pipeline.name.toLowerCase());
  if (component) {
    const start = pipeline.startEvolution ?? Math.max(0, component.evolution - 0.08);
    const end = pipeline.endEvolution ?? Math.min(1, component.evolution + 0.18);
    const x = xFor(Math.min(start, end), width);
    return {
      x,
      y: yFor(component.visibility, height) - fallbackHeight / 2,
      width: Math.max(18, xFor(Math.max(start, end), width) - x),
      height: fallbackHeight
    };
  }
  if (pipeline.startEvolution === undefined || pipeline.endEvolution === undefined) {
    return undefined;
  }
  const start = Math.min(pipeline.startEvolution, pipeline.endEvolution);
  const end = Math.max(pipeline.startEvolution, pipeline.endEvolution);
  const x = xFor(start, width);
  const contained = components
    .filter((candidate) => candidate.kind !== "anchor" && candidate.evolution >= start && candidate.evolution <= end)
    .map((candidate) => yFor(candidate.visibility, height));
  if (contained.length === 0) {
    const plotTop = MARGIN.top;
    const plotBottom = height - MARGIN.bottom;
    return {
      x,
      y: Math.round(plotTop + (plotBottom - plotTop) * 0.42),
      width: Math.max(18, xFor(end, width) - x),
      height: fallbackHeight
    };
  }
  const minY = Math.min(...contained);
  const maxY = Math.max(...contained);
  return {
    x,
    y: Math.max(MARGIN.top + 6, minY - fallbackHeight / 2),
    width: Math.max(18, xFor(end, width) - x),
    height: Math.max(fallbackHeight, maxY - minY + fallbackHeight)
  };
}

function renderLink(
  link: WardleyLink,
  source: WardleyComponent | undefined,
  target: WardleyComponent | undefined,
  edgeId: string,
  edgeIndex: number,
  width: number,
  height: number,
  colors: Record<string, string>,
  routeObstacles: readonly RouteObstacle[]
): string {
  if (!source || !target) {
    return "";
  }
  const a = pointFor(source.visibility, source.evolution, width, height);
  const b = pointFor(target.visibility, target.evolution, width, height);
  const shortened = shortenSegment(a, b, NODE_RADIUS + 3);
  const curve = routeQuadraticSegment(shortened.a, shortened.b, {
    obstacles: routeObstacles,
    ignoredComponentIds: [source.id, target.id],
    padding: 4,
    bendDirection: edgeIndex % 2 === 0 ? 1 : -1
  });
  const labelPoint = quadraticPoint(shortened.a, curve.control, shortened.b, 0.52);
  const path = `M${shortened.a.x},${shortened.a.y} Q${curve.control.x},${curve.control.y} ${shortened.b.x},${shortened.b.y}`;
  const label = link.context ?? link.flowLabel;
  const className = `wardley-link wardley-link-${link.kind}`;
  return `<g ${focusLinkAttributes(edgeId, source, target)}>
    <path class="wardley-link-hit-area" d="${path}" fill="none" stroke="transparent" stroke-width="13" stroke-linecap="round" pointer-events="stroke" />
    <path class="${className}" d="${path}" fill="none" stroke="${colors.edge}" stroke-width="1.45" stroke-linecap="round" ${linkMarkerAttributes(link, "wardley-arrow")} />
    ${label ? renderEdgeLabel(label, labelPoint, colors, width, height) : ""}
  </g>`;
}

function renderLinkEdge(
  edge: WardleyGraphEdge,
  graph: WardleyGraph,
  width: number,
  height: number,
  colors: Record<string, string>,
  routeObstacles: readonly RouteObstacle[]
): string {
  if (!edge.link) {
    return "";
  }
  return renderLink(
    edge.link,
    graph.nodesById.get(edge.sourceId)?.component,
    graph.nodesById.get(edge.targetId)?.component,
    edge.id,
    edgeOrdinal(edge),
    width,
    height,
    colors,
    routeObstacles
  );
}

function renderSketchLink(
  link: WardleyLink,
  source: WardleyComponent | undefined,
  target: WardleyComponent | undefined,
  edgeId: string,
  edgeIndex: number,
  width: number,
  height: number,
  colors: Record<string, string>,
  routeObstacles: readonly RouteObstacle[]
): string {
  if (!source || !target) {
    return "";
  }
  const a = pointFor(source.visibility, source.evolution, width, height);
  const b = pointFor(target.visibility, target.evolution, width, height);
  const radius = source.kind === "anchor" ? 20 : 14;
  const shortened = shortenSegment(a, b, radius);
  const curve = routeQuadraticSegment(shortened.a, shortened.b, {
    obstacles: routeObstacles,
    ignoredComponentIds: [source.id, target.id],
    padding: 5,
    bendDirection: edgeIndex % 2 === 0 ? 1 : -1
  });
  const label = link.context ?? link.flowLabel;
  const labelPoint = quadraticPoint(shortened.a, curve.control, shortened.b, 0.52);
  const path = `M${shortened.a.x},${shortened.a.y} Q${curve.control.x},${curve.control.y} ${shortened.b.x},${shortened.b.y}`;
  return `<g ${focusLinkAttributes(edgeId, source, target)}>
    <path class="wardley-link-hit-area" d="${path}" fill="none" stroke="transparent" stroke-width="15" stroke-linecap="round" pointer-events="stroke" />
    <path class="wardley-link wardley-link-${link.kind}" d="${path}" fill="none" stroke="${colors.edge}" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" ${linkMarkerAttributes(link, "wardley-sketch-arrow")} />
    ${label ? renderSketchEdgeLabel(label, labelPoint, colors, width, height) : ""}
  </g>`;
}

function renderSketchLinkEdge(
  edge: WardleyGraphEdge,
  graph: WardleyGraph,
  width: number,
  height: number,
  colors: Record<string, string>,
  routeObstacles: readonly RouteObstacle[]
): string {
  if (!edge.link) {
    return "";
  }
  return renderSketchLink(
    edge.link,
    graph.nodesById.get(edge.sourceId)?.component,
    graph.nodesById.get(edge.targetId)?.component,
    edge.id,
    edgeOrdinal(edge),
    width,
    height,
    colors,
    routeObstacles
  );
}

function renderEvolution(
  component: WardleyComponent | undefined,
  target: WardleyComponent | undefined,
  evolution: number,
  targetName: string | undefined,
  edgeId: string,
  byName: Map<string, WardleyComponent>,
  width: number,
  height: number,
  stroke: string
): string {
  if (!component) {
    return "";
  }
  const a = pointFor(component.visibility, component.evolution, width, height);
  const b = pointFor(component.visibility, evolution, width, height);
  const targetExists = targetName ? byName.has(targetName.toLowerCase()) : false;
  const targetLabel = targetName ? compactText(targetName, 28) : undefined;
  return `<g ${focusLinkAttributes(edgeId, component, target ?? component)}>
    <line class="wardley-link-hit-area" x1="${a.x + 10}" y1="${a.y}" x2="${b.x - 10}" y2="${b.y}" stroke="transparent" stroke-width="12" stroke-linecap="round" pointer-events="stroke" />
    <line class="wardley-link wardley-link-evolution" x1="${a.x + 10}" y1="${a.y}" x2="${b.x - 10}" y2="${b.y}" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#wardley-evolve-arrow)" />
    ${targetLabel && !targetExists ? `<text x="${b.x + 12}" y="${b.y - 12}" fill="${stroke}" font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="600">${escapeXml(targetLabel)}</text>` : ""}
  </g>`;
}

function renderEvolutionEdge(
  edge: WardleyGraphEdge,
  graph: WardleyGraph,
  byName: Map<string, WardleyComponent>,
  width: number,
  height: number,
  stroke: string
): string {
  if (!edge.evolution) {
    return "";
  }
  return renderEvolution(
    graph.nodesById.get(edge.sourceId)?.component,
    graph.nodesById.get(edge.targetId)?.component,
    edge.evolution.evolution,
    edge.evolution.targetName,
    edge.id,
    byName,
    width,
    height,
    stroke
  );
}

function renderSketchEvolution(
  component: WardleyComponent | undefined,
  target: WardleyComponent | undefined,
  evolution: number,
  edgeId: string,
  width: number,
  height: number,
  stroke: string
): string {
  if (!component) {
    return "";
  }
  const a = pointFor(component.visibility, component.evolution, width, height);
  const b = pointFor(component.visibility, evolution, width, height);
  const path = `M${a.x + 14},${a.y} C${a.x + 42},${a.y - 6} ${b.x - 38},${b.y + 6} ${b.x - 14},${b.y}`;
  return `<g ${focusLinkAttributes(edgeId, component, target ?? component)}>
    <path class="wardley-link-hit-area" d="${path}" fill="none" stroke="transparent" stroke-width="14" stroke-linecap="round" pointer-events="stroke" />
    <path class="wardley-link wardley-link-evolution" d="${path}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-dasharray="6 5" stroke-linecap="round" />
  </g>`;
}

function renderSketchEvolutionEdge(
  edge: WardleyGraphEdge,
  graph: WardleyGraph,
  width: number,
  height: number,
  stroke: string
): string {
  if (!edge.evolution) {
    return "";
  }
  return renderSketchEvolution(
    graph.nodesById.get(edge.sourceId)?.component,
    graph.nodesById.get(edge.targetId)?.component,
    edge.evolution.evolution,
    edge.id,
    width,
    height,
    stroke
  );
}

function renderComponent(component: WardleyComponent, point: RenderPoint, colors: Record<string, string>, placement?: ComponentLabelPlacement | undefined): string {
  const label = placement ?? componentLabelPlacement(component, point, "clean");
  const fill = componentFill(component, colors);
  const ring = component.inertia
    ? `<circle cx="${point.x}" cy="${point.y}" r="12" fill="none" stroke="${colors.annotation}" stroke-width="2.4" stroke-dasharray="3 3" />`
    : "";
  return `<g ${focusComponentAttributes(component)}>
    ${ring}
    <rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="4" fill="${colors.background}" fill-opacity="0.9" />
    ${renderCleanComponentGlyph(component, point, fill, colors)}
    ${renderCleanMultilineText(label.text, label.textX, label.textY, colors.text ?? "#111827", label.fontSize, label.lineHeight, 650)}
    ${renderComponentHitArea(component, point, "clean")}
  </g>`;
}

function renderSketchComponent(component: WardleyComponent, point: RenderPoint, colors: Record<string, string>, placement?: ComponentLabelPlacement | undefined): string {
  const label = placement ?? componentLabelPlacement(component, point, "sketch");
  const labelSvg = renderSketchMultilineText(label.text, label.textX, label.textY, colors.text ?? "#262626", label.fontSize, label.lineHeight);
  if (component.kind === "anchor") {
    return `<g ${focusComponentAttributes(component)}>
    <circle cx="${point.x}" cy="${point.y - 31}" r="16" fill="url(#wardley-sketch-node-hatch)" stroke="${colors.component}" stroke-width="2" />
    <rect x="${point.x - 19}" y="${point.y - 14}" width="38" height="48" rx="10" fill="url(#wardley-sketch-node-hatch)" stroke="${colors.component}" stroke-width="2" />
    <path d="M${point.x - 13},${point.y + 1} C${point.x - 5},${point.y - 5} ${point.x + 9},${point.y - 5} ${point.x + 15},${point.y + 2}" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.35" />
    ${labelSvg}
    ${renderComponentHitArea(component, point, "sketch")}
  </g>`;
  }
  const ring = component.inertia
    ? `<circle cx="${point.x}" cy="${point.y}" r="17" fill="none" stroke="${colors.annotation}" stroke-width="2.2" stroke-dasharray="4 4" />`
    : "";
  return `<g ${focusComponentAttributes(component)}>
    ${ring}
    ${renderSketchComponentGlyph(component, point, colors)}
    ${labelSvg}
    ${renderComponentHitArea(component, point, "sketch")}
  </g>`;
}

function placeComponentLabels(map: WardleyMap, width: number, height: number, notation: "clean" | "sketch", graph: WardleyGraph): ReadonlyMap<string, ComponentLabelPlacement> {
  const segments = labelAvoidanceSegments(map, width, height, notation, graph);
  const obstacles: readonly (PlacedTextBox & { readonly componentId: string })[] = map.components.map((component) => {
    const point = pointFor(component.visibility, component.evolution, width, height);
    const metrics = componentNodeObstacleMetrics(component, point, notation);
    return {
      id: `component-node:${component.id}`,
      ...metrics,
      componentId: component.id
    };
  });
  const placementSegments = [
    ...segments,
    ...routedLabelAvoidanceSegments(segments, obstacles, notation)
  ];
  const orderedComponents = orderComponentsForLabelPlacement(map.components, graph);
  const pinnedComponents = orderedComponents.filter((component) => shouldPinSketchComponentLabel(component, notation, graph));
  const pinnedBoxes: readonly PlacedTextBox[] = pinnedComponents.map((component) => {
    const point = pointFor(component.visibility, component.evolution, width, height);
    const metrics = componentLabelPlacement(component, point, notation);
    return {
      id: component.id,
      x: metrics.x,
      y: metrics.y,
      width: metrics.width,
      height: metrics.height
    };
  });
  const placementComponents = orderedComponents.filter((component) => !shouldPinSketchComponentLabel(component, notation, graph));
  const placementBoxes: readonly TextPlacementBox[] = placementComponents.map((component) => {
    const point = pointFor(component.visibility, component.evolution, width, height);
    const metrics = componentLabelPlacement(component, point, notation);
    const centeredAnchorLabel = notation === "sketch"
      && component.kind === "anchor"
      && (!component.label || shouldCenterDetachedAnchorLabel(component));
    const ignoredObstacleIds = centeredAnchorLabel ? [] : [`component-node:${component.id}`];
    return {
      id: component.id,
      anchorX: metrics.x,
      anchorY: metrics.y,
      width: metrics.width,
      height: metrics.height,
      ignoredObstacleIds,
      ignoredSegmentIds: placementSegments
        .filter((segment) => segment.sourceComponentId === component.id || segment.targetComponentId === component.id)
        .map((segment) => segment.id)
    };
  });
  const bounds = {
    left: 16,
    top: Math.max(8, MARGIN.top - 60),
    right: width - 16,
    bottom: height - MARGIN.bottom - 8
  };
  const placementObstacles = map.title ? [titlePlacementObstacle(map.title, notation), ...obstacles, ...pinnedBoxes] : [...obstacles, ...pinnedBoxes];
  const placed = new Map(placeTextBoxes(placementBoxes, bounds, 4, {
    obstacles: placementObstacles,
    segments: placementSegments,
    candidateMode: shouldUseGraphPriorityLabelOrder(graph) ? "expanded" : "local"
  }).map((box) => [box.id, box]));
  for (const box of pinnedBoxes) {
    placed.set(box.id, box);
  }
  return new Map(orderedComponents.map((component) => {
    const point = pointFor(component.visibility, component.evolution, width, height);
    const metrics = componentLabelPlacement(component, point, notation);
    const box = placed.get(component.id);
    if (!box) {
      return [component.id, metrics] as const;
    }
    return [component.id, {
      ...metrics,
      x: box.x,
      y: box.y,
      textX: box.x + (metrics.textX - metrics.x),
      textY: box.y + (metrics.textY - metrics.y)
    }] as const;
  }));
}

function orderComponentsForLabelPlacement(components: readonly WardleyComponent[], graph: WardleyGraph): readonly WardleyComponent[] {
  if (!shouldUseGraphPriorityLabelOrder(graph)) {
    return components;
  }
  const originalIndex = new Map(components.map((component, index) => [component.id, index]));
  return [...components].sort((a, b) => {
    const priority = componentLabelPriority(b, graph) - componentLabelPriority(a, graph);
    if (priority !== 0) {
      return priority;
    }
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  });
}

function componentLabelPriority(component: WardleyComponent, graph: WardleyGraph): number {
  const node = graph.nodesById.get(component.id);
  const graphWeight = (node?.degree ?? 0) * 8 + (node?.outDegree ?? 0) * 2;
  const anchorWeight = component.kind === "anchor" ? 120 : 0;
  const topVisibleWeight = component.visibility >= 0.78 ? 24 : 0;
  return anchorWeight + topVisibleWeight + graphWeight;
}

function shouldUseGraphPriorityLabelOrder(graph: WardleyGraph): boolean {
  return graph.nodes.length >= 24 || graph.linkEdges.length >= 32;
}

function titlePlacementObstacle(title: string, notation: "clean" | "sketch"): PlacedTextBox {
  const displayTitle = layoutWardleyTitleText(title, notation);
  return {
    id: "map-title",
    x: MARGIN.left - 8,
    y: 0,
    width: displayTitle.width + 22,
    height: MARGIN.top - 12
  };
}

function componentRouteObstacles(
  map: WardleyMap,
  width: number,
  height: number,
  notation: "clean" | "sketch",
  labelPlacements: ReadonlyMap<string, ComponentLabelPlacement>
): readonly RouteObstacle[] {
  return [
    ...map.components.map((component) => {
      const point = pointFor(component.visibility, component.evolution, width, height);
      const metrics = componentNodeObstacleMetrics(component, point, notation);
      return {
        id: `component-node:${component.id}`,
        ...metrics,
        componentId: component.id,
        weight: 4
      };
    }),
    ...map.components.flatMap((component) => {
      const placement = labelPlacements.get(component.id);
      return placement ? [{
        id: `component-label:${component.id}`,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        componentId: component.id,
        weight: 1
      }] : [];
    })
  ];
}

function markerRouteObstacles(
  map: WardleyMap,
  width: number,
  height: number,
  markerLabelPlacements: ReadonlyMap<string, MarkerLabelPlacement>
): readonly RouteObstacle[] {
  return [
    ...map.markers.map((marker) => {
      const point = markerLabelPlacements.get(marker.id) ?? markerLabelPlacement(marker, pointFor(marker.visibility, marker.evolution, width, height), "clean");
      return {
        id: `marker-node:${marker.id}`,
        x: point.glyphX - 14,
        y: point.glyphY - 14,
        width: 28,
        height: 28,
        weight: 2
      };
    }),
    ...map.markers.flatMap((marker) => {
      const placement = markerLabelPlacements.get(marker.id);
      return placement ? [{
        id: `marker-label:${marker.id}`,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        weight: 1
      }] : [];
    })
  ];
}

function componentNodeObstacleMetrics(
  component: WardleyComponent,
  point: RenderPoint,
  notation: "clean" | "sketch"
): Pick<RouteObstacle, "x" | "y" | "width" | "height"> {
  if (component.kind === "anchor" && notation === "sketch") {
    return {
      x: point.x - 19,
      y: point.y - 47,
      width: 38,
      height: 81
    };
  }
  const radius = component.kind === "anchor"
    ? 14
    : notation === "sketch" ? 15 : 9;
  return {
    x: point.x - radius,
    y: point.y - radius,
    width: radius * 2,
    height: radius * 2
  };
}

function placeMarkerLabels(
  map: WardleyMap,
  width: number,
  height: number,
  notation: "clean" | "sketch",
  obstacles: readonly PlacedTextBox[],
  segments: readonly TextPlacementSegment[]
): ReadonlyMap<string, MarkerLabelPlacement> {
  const markerNodeObstacles: readonly PlacedTextBox[] = map.markers.map((marker) => {
    const point = pointFor(marker.visibility, marker.evolution, width, height);
    return {
      id: `marker-node:${marker.id}`,
      x: point.x - 14,
      y: point.y - 14,
      width: 28,
      height: 28
    };
  });
  const placementBoxes: readonly TextPlacementBox[] = map.markers.map((marker) => {
    const point = pointFor(marker.visibility, marker.evolution, width, height);
    const metrics = markerLabelPlacement(marker, point, notation);
    return {
      id: marker.id,
      anchorX: metrics.x,
      anchorY: metrics.y,
      width: metrics.width,
      height: metrics.height
    };
  });
  const bounds = {
    left: 16,
    top: Math.max(8, MARGIN.top - 60),
    right: width - 16,
    bottom: height - MARGIN.bottom - 8
  };
  const placed = new Map(placeTextBoxes(placementBoxes, bounds, 4, {
    obstacles: [...obstacles, ...markerNodeObstacles],
    segments,
    candidateMode: map.components.length + map.markers.length >= 24 ? "expanded" : "local"
  }).map((box) => [box.id, box]));
  const componentNodeObstacles = obstacles.filter((obstacle) => obstacle.id.startsWith("component-node:"));
  return new Map(map.markers.map((marker) => {
    const point = pointFor(marker.visibility, marker.evolution, width, height);
    const metrics = markerLabelPlacement(marker, point, notation);
    const box = placed.get(marker.id);
    if (!box) {
      return [marker.id, metrics] as const;
    }
    const glyphPoint = markerGlyphPoint(point, box, componentNodeObstacles);
    return [marker.id, {
      ...metrics,
      x: box.x,
      y: box.y,
      textX: box.x + (metrics.textX - metrics.x),
      textY: box.y + (metrics.textY - metrics.y),
      glyphX: glyphPoint.x,
      glyphY: glyphPoint.y
    }] as const;
  }));
}

function componentLabelPlacement(component: WardleyComponent, point: RenderPoint, notation: "clean" | "sketch"): ComponentLabelPlacement {
  const label = component.label ?? (notation === "sketch"
    ? component.kind === "anchor" ? { x: -48, y: -54 } : { x: 15, y: 6 }
    : { x: 12, y: -12 });
  const text = layoutComponentLabelText(component, notation);
  if (notation === "sketch" && component.kind === "anchor" && (!component.label || shouldCenterDetachedAnchorLabel(component))) {
    const textX = point.x - text.width / 2;
    const textY = point.y - 62 - ((text.lines.length - 1) * text.lineHeight);
    return {
      id: component.id,
      text: text.text,
      x: textX - 4,
      y: textY - text.fontSize,
      width: Math.max(18, text.width + 8),
      height: Math.max(18, text.height),
      textX,
      textY,
      fontSize: text.fontSize,
      lineHeight: text.lineHeight
    };
  }
  if (notation === "sketch" && shouldCenterDetachedTopLabel(component)) {
    const textX = point.x - text.width / 2;
    const textY = point.y - 26 - ((text.lines.length - 1) * text.lineHeight);
    return {
      id: component.id,
      text: text.text,
      x: textX - 4,
      y: textY - text.fontSize,
      width: Math.max(18, text.width + 8),
      height: Math.max(18, text.height),
      textX,
      textY,
      fontSize: text.fontSize,
      lineHeight: text.lineHeight
    };
  }
  const textX = point.x + label.x;
  const textY = point.y + label.y;
  const x = label.x < 0 ? textX - 5 : textX - 4;
  const y = notation === "sketch" ? textY - text.fontSize : textY - 13;
  return {
    id: component.id,
    text: text.text,
    x,
    y,
    width: Math.max(18, text.width + 8),
    height: Math.max(18, text.height),
    textX,
    textY,
    fontSize: text.fontSize,
    lineHeight: text.lineHeight
  };
}

function markerLabelPlacement(marker: WardleyMarker, point: RenderPoint, notation: "clean" | "sketch"): MarkerLabelPlacement {
  const label = marker.label ?? { x: 14, y: -10 };
  const text = layoutMarkerLabelText(marker, notation);
  const textX = point.x + label.x;
  const textY = point.y + label.y;
  return {
    id: marker.id,
    text: text.text,
    x: textX - 4,
    y: textY - text.fontSize,
    width: Math.max(18, text.width + 8),
    height: Math.max(18, text.height + 1),
    textX,
    textY,
    glyphX: point.x,
    glyphY: point.y,
    fontSize: text.fontSize,
    lineHeight: text.lineHeight
  };
}

function markerGlyphPoint(
  point: RenderPoint,
  labelBox: PlacedTextBox,
  obstacles: readonly PlacedTextBox[]
): RenderPoint {
  const markerBox = {
    x: point.x - 14,
    y: point.y - 14,
    width: 28,
    height: 28
  };
  if (!obstacles.some((obstacle) => placedBoxesOverlap(markerBox, obstacle, 0))) {
    return point;
  }
  const centerX = labelBox.x + labelBox.width / 2;
  const centerY = labelBox.y + labelBox.height / 2;
  const dx = centerX - point.x;
  const dy = centerY - point.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) {
    return { x: point.x + 22, y: point.y - 10 };
  }
  const offset = 36;
  return {
    x: Math.round(point.x + (dx / distance) * offset),
    y: Math.round(point.y + (dy / distance) * offset)
  };
}

function placedBoxesOverlap(a: Pick<PlacedTextBox, "x" | "y" | "width" | "height">, b: Pick<PlacedTextBox, "x" | "y" | "width" | "height">, padding: number): boolean {
  return a.x - padding < b.x + b.width
    && a.x + a.width + padding > b.x
    && a.y - padding < b.y + b.height
    && a.y + a.height + padding > b.y;
}

function shouldCenterDetachedAnchorLabel(component: WardleyComponent): boolean {
  return component.kind === "anchor"
    && component.label !== undefined
    && component.label.x <= -120
    && Math.abs(component.label.y) <= 28;
}

function shouldUseCenteredSketchAnchorLabel(component: WardleyComponent): boolean {
  return component.kind === "anchor" && (!component.label || shouldCenterDetachedAnchorLabel(component));
}

function shouldCenterDetachedTopLabel(component: WardleyComponent): boolean {
  return component.kind === "component"
    && component.label !== undefined
    && component.visibility >= 0.78
    && component.label.x <= -90
    && Math.abs(component.label.y) <= 24;
}

function shouldPinSketchComponentLabel(component: WardleyComponent, notation: "clean" | "sketch", graph: WardleyGraph): boolean {
  return notation === "sketch"
    && shouldUseGraphPriorityLabelOrder(graph)
    && (shouldUseCenteredSketchAnchorLabel(component) || shouldCenterDetachedTopLabel(component));
}

function labelAvoidanceSegments(map: WardleyMap, width: number, height: number, notation: "clean" | "sketch", graph: WardleyGraph): readonly LabelAvoidanceSegment[] {
  const segments: LabelAvoidanceSegment[] = [];
  for (const edge of graph.linkEdges) {
    const source = graph.nodesById.get(edge.sourceId)?.component;
    const target = graph.nodesById.get(edge.targetId)?.component;
    if (!source || !target) {
      continue;
    }
    const shortened = shortenSegment(
      pointFor(source.visibility, source.evolution, width, height),
      pointFor(target.visibility, target.evolution, width, height),
      notation === "sketch" ? 17 : NODE_RADIUS + 3
    );
    segments.push({
      id: edge.id,
      x1: shortened.a.x,
      y1: shortened.a.y,
      x2: shortened.b.x,
      y2: shortened.b.y,
      sourceComponentId: source.id,
      targetComponentId: target.id
    });
  }
  for (const edge of graph.evolutionEdges) {
    const source = graph.nodesById.get(edge.sourceId)?.component;
    const evolution = edge.evolution;
    if (!source) {
      continue;
    }
    const start = pointFor(source.visibility, source.evolution, width, height);
    const end = pointFor(source.visibility, evolution?.evolution ?? source.evolution, width, height);
    segments.push({
      id: edge.id,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      sourceComponentId: source.id,
      targetComponentId: edge.targetId
    });
  }
  map.annotations.forEach((annotation, index) => {
    if (annotation.visibilityEnd === undefined || annotation.evolutionEnd === undefined) {
      return;
    }
    const start = pointFor(annotation.visibility, annotation.evolution, width, height);
    segments.push({
      id: `annotation-${index + 1}`,
      x1: start.x,
      y1: start.y,
      x2: xFor(annotation.evolutionEnd, width),
      y2: yFor(annotation.visibilityEnd, height)
    });
  });
  return segments;
}

function routedLabelAvoidanceSegments(
  segments: readonly LabelAvoidanceSegment[],
  obstacles: readonly RouteObstacle[],
  notation: "clean" | "sketch"
): readonly LabelAvoidanceSegment[] {
  return segments.flatMap((segment, index) => {
    if (!segment.sourceComponentId || !segment.targetComponentId || segment.id.startsWith("annotation-")) {
      return [];
    }
    const curve = routeQuadraticSegment(
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
      {
        obstacles,
        ignoredComponentIds: [segment.sourceComponentId, segment.targetComponentId],
        padding: notation === "sketch" ? 5 : 4,
        bendDirection: index % 2 === 0 ? 1 : -1
      }
    );
    return quadraticRouteSegments(curve).map(([start, end], pieceIndex) => ({
      ...segment,
      id: `${segment.id}:routed-${pieceIndex + 1}`,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y
    }));
  });
}

function renderCleanComponentGlyph(component: WardleyComponent, point: RenderPoint, fill: string, colors: Record<string, string>): string {
  if (component.kind === "market") {
    return `<circle class="wardley-component wardley-component-market" cx="${point.x}" cy="${point.y}" r="${NODE_RADIUS + 2}" fill="${colors.background}" stroke="${fill}" stroke-width="2" />
    <circle cx="${point.x}" cy="${point.y}" r="${NODE_RADIUS - 2}" fill="${fill}" />`;
  }
  if (component.kind === "ecosystem") {
    const r = NODE_RADIUS + 3;
    return `<path class="wardley-component wardley-component-ecosystem" d="M${point.x},${point.y - r} L${point.x + r},${point.y} L${point.x},${point.y + r} L${point.x - r},${point.y} Z" fill="${fill}" stroke="${colors.background}" stroke-width="2" />`;
  }
  if (component.kind === "submap") {
    return `<rect class="wardley-component wardley-component-submap" x="${point.x - 8}" y="${point.y - 7}" width="16" height="14" rx="2" fill="${fill}" stroke="${colors.background}" stroke-width="2" />
    <path d="M${point.x + 3},${point.y - 7} L${point.x + 8},${point.y - 2} L${point.x + 3},${point.y - 2} Z" fill="${colors.background}" fill-opacity="0.72" />`;
  }
  return `<circle class="wardley-component wardley-component-${component.kind}" cx="${point.x}" cy="${point.y}" r="${NODE_RADIUS}" fill="${fill}" stroke="${colors.background}" stroke-width="2" />`;
}

function renderSketchComponentGlyph(component: WardleyComponent, point: RenderPoint, colors: Record<string, string>): string {
  const stroke = component.kind === "market" ? colors.market : component.kind === "ecosystem" ? colors.ecosystem : colors.component;
  if (component.kind === "market") {
    return `<circle class="wardley-component wardley-component-market" cx="${point.x}" cy="${point.y}" r="15" fill="none" stroke="${stroke}" stroke-width="2.3" />
    <circle cx="${point.x}" cy="${point.y}" r="9" fill="url(#wardley-sketch-node-hatch)" stroke="${stroke}" stroke-width="1.8" />`;
  }
  if (component.kind === "ecosystem") {
    return `<path class="wardley-component wardley-component-ecosystem" d="M${point.x},${point.y - 15} C${point.x + 14},${point.y - 3} ${point.x + 15},${point.y + 5} ${point.x},${point.y + 15} C${point.x - 13},${point.y + 3} ${point.x - 14},${point.y - 5} ${point.x},${point.y - 15} Z" fill="url(#wardley-sketch-node-hatch)" stroke="${stroke}" stroke-width="2" />`;
  }
  if (component.kind === "submap") {
    return `<path class="wardley-component wardley-component-submap" d="M${point.x - 12},${point.y - 11} L${point.x + 7},${point.y - 11} L${point.x + 13},${point.y - 4} L${point.x + 12},${point.y + 11} L${point.x - 12},${point.y + 11} Z" fill="url(#wardley-sketch-node-hatch)" stroke="${stroke}" stroke-width="2" />`;
  }
  return `<circle class="wardley-component wardley-component-${component.kind}" cx="${point.x}" cy="${point.y}" r="13" fill="url(#wardley-sketch-node-hatch)" stroke="${stroke}" stroke-width="2" />`;
}

function renderComponentHitArea(component: WardleyComponent, point: RenderPoint, notation: "clean" | "sketch"): string {
  if (component.kind === "anchor") {
    const width = notation === "sketch" ? 58 : 44;
    const top = notation === "sketch" ? 56 : 42;
    const bottom = notation === "sketch" ? 44 : 32;
    return `<rect class="wardley-component-hit-area" x="${point.x - width / 2}" y="${point.y - top}" width="${width}" height="${top + bottom}" rx="16" fill="transparent" stroke="transparent" pointer-events="all" aria-hidden="true" />`;
  }
  const radius = notation === "sketch" ? 24 : 20;
  return `<circle class="wardley-component-hit-area" cx="${point.x}" cy="${point.y}" r="${radius}" fill="transparent" stroke="transparent" pointer-events="all" aria-hidden="true" />`;
}

function renderMarker(
  marker: WardleyMarker,
  width: number,
  height: number,
  colors: Record<string, string>,
  placement?: MarkerLabelPlacement | undefined
): string {
  const point = pointFor(marker.visibility, marker.evolution, width, height);
  const color = marker.kind === "accelerator" ? colors.accelerator ?? "#16a34a" : colors.deaccelerator ?? "#dc2626";
  const glyphX = placement?.glyphX ?? point.x;
  const glyphY = placement?.glyphY ?? point.y;
  const glyph = marker.kind === "accelerator"
    ? `<path d="M${glyphX - 7},${glyphY + 7} L${glyphX},${glyphY - 9} L${glyphX + 7},${glyphY + 7} Z" fill="${color}" />`
    : `<path d="M${glyphX - 8},${glyphY - 7} L${glyphX + 8},${glyphY - 7} L${glyphX},${glyphY + 9} Z" fill="${color}" />`;
  const text = placement ?? markerLabelPlacement(marker, point, "clean");
  return `<g class="wardley-marker wardley-marker-${marker.kind}" data-wardley-marker-id="${escapeXml(marker.id)}">
    ${glyph}
    ${renderCleanMultilineText(text.text, text.textX, text.textY, color, text.fontSize, text.lineHeight, 700)}
  </g>`;
}

function renderSketchMarker(
  marker: WardleyMarker,
  width: number,
  height: number,
  colors: Record<string, string>,
  placement?: MarkerLabelPlacement | undefined
): string {
  const point = pointFor(marker.visibility, marker.evolution, width, height);
  const color = marker.kind === "accelerator" ? colors.accelerator ?? "#18824f" : colors.deaccelerator ?? "#b91c1c";
  const glyphX = placement?.glyphX ?? point.x;
  const glyphY = placement?.glyphY ?? point.y;
  const path = marker.kind === "accelerator"
    ? `M${glyphX - 12},${glyphY + 12} C${glyphX - 4},${glyphY + 2} ${glyphX - 1},${glyphY - 6} ${glyphX},${glyphY - 15} M${glyphX},${glyphY - 15} l-8,8 M${glyphX},${glyphY - 15} l8,8`
    : `M${glyphX - 12},${glyphY - 12} C${glyphX - 4},${glyphY - 2} ${glyphX - 1},${glyphY + 6} ${glyphX},${glyphY + 15} M${glyphX},${glyphY + 15} l-8,-8 M${glyphX},${glyphY + 15} l8,-8`;
  const text = placement ?? markerLabelPlacement(marker, point, "sketch");
  return `<g class="wardley-marker wardley-marker-${marker.kind}" data-wardley-marker-id="${escapeXml(marker.id)}">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ${renderSketchMultilineText(text.text, text.textX, text.textY, color, text.fontSize, text.lineHeight)}
  </g>`;
}

function placeCleanTextCallouts(
  map: WardleyMap,
  width: number,
  height: number,
  colors: Record<string, string>,
  obstacles: readonly RouteObstacle[],
  segments: readonly TextPlacementSegment[]
): readonly CleanCalloutPlacement[] {
  const callouts: CleanCallout[] = [
    ...map.notes.map((note, index) => ({
      id: `note-${index + 1}`,
      kind: "note" as const,
      text: note.text,
      color: colors.note ?? "#7c3aed",
      point: pointFor(note.visibility, note.evolution, width, height)
    })),
    ...map.annotations.map((annotation) => ({
      id: `annotation-${annotation.id}`,
      kind: "annotation" as const,
      text: `${annotation.id}. ${annotation.text}`,
      color: colors.annotation ?? "#ca8a04",
      point: pointFor(annotation.visibility, annotation.evolution, width, height),
      annotation
    }))
  ];
  const boxes = callouts.map((callout) => cleanTextBox(callout.id, callout.kind, callout.text, callout.point, width, height));
  const placementObstacles: readonly PlacedTextBox[] = obstacles.map((obstacle) => ({
    id: obstacle.id,
    x: obstacle.x,
    y: obstacle.y,
    width: obstacle.width,
    height: obstacle.height
  }));
  const placements = new Map(placeTextBoxes(boxes, {
    left: MARGIN.left + 8,
    top: MARGIN.top + 8,
    right: width - 16,
    bottom: height - MARGIN.bottom - 8
  }, 3, { obstacles: placementObstacles, segments, candidateMode: "expanded" }).map((box) => [box.id, box]));
  return callouts.map((callout) => {
    const metrics = cleanTextBox(callout.id, callout.kind, callout.text, callout.point, width, height);
    const box = placements.get(callout.id) ?? {
      id: metrics.id,
      x: metrics.anchorX,
      y: metrics.anchorY,
      width: metrics.width,
      height: metrics.height
    };
    return {
      ...callout,
      box
    };
  });
}

function renderCleanTextCallouts(callouts: readonly CleanCalloutPlacement[], width: number, height: number): string {
  return callouts.map((callout) => {
    const leader = callout.annotation?.visibilityEnd !== undefined && callout.annotation.evolutionEnd !== undefined
      ? `<line x1="${callout.point.x}" y1="${callout.point.y}" x2="${xFor(callout.annotation.evolutionEnd, width)}" y2="${yFor(callout.annotation.visibilityEnd, height)}" stroke="${callout.color}" stroke-width="1.5" stroke-dasharray="4 4" />`
      : "";
    const trigger = callout.kind === "annotation"
      ? `<circle class="wardley-callout-trigger" cx="${callout.point.x}" cy="${callout.point.y}" r="5" fill="${callout.color}" fill-opacity="0.18" stroke="${callout.color}" stroke-width="1.5" />`
      : "";
    return `<g data-wardley-callout-id="${escapeXml(callout.id)}" data-wardley-callout-kind="${callout.kind}">
    <g class="wardley-callout-trigger-layer">${leader}${trigger}</g>
    <g class="wardley-callout-body">${renderCleanCalloutBox(callout.text, callout.kind, callout.color, callout.box)}</g>
  </g>`;
  }).join("\n  ");
}

function placeSketchTextCallouts(
  map: WardleyMap,
  width: number,
  height: number,
  colors: Record<string, string>,
  obstacles: readonly RouteObstacle[],
  segments: readonly TextPlacementSegment[]
): readonly SketchCalloutPlacement[] {
  const callouts: SketchCallout[] = [
    ...map.notes.map((note, index) => ({
      id: `note-${index + 1}`,
      kind: "note" as const,
      text: note.text,
      color: colors.note ?? "#27272a",
      point: pointFor(note.visibility, note.evolution, width, height)
    })),
    ...map.annotations.map((annotation) => ({
      id: `annotation-${annotation.id}`,
      kind: "annotation" as const,
      text: `${annotation.id}. ${annotation.text}`,
      color: colors.annotation ?? "#ca8a04",
      point: pointFor(annotation.visibility, annotation.evolution, width, height),
      annotation
    }))
  ];
  const boxes = callouts.map((callout) => sketchTextBox(callout.id, callout.kind, callout.text, callout.point));
  const placementObstacles: readonly PlacedTextBox[] = obstacles.map((obstacle) => ({
    id: obstacle.id,
    x: obstacle.x,
    y: obstacle.y,
    width: obstacle.width,
    height: obstacle.height
  }));
  const placements = new Map(placeTextBoxes(boxes, {
    left: MARGIN.left - 24,
    top: MARGIN.top - 48,
    right: width - 16,
    bottom: height - MARGIN.bottom - 8
  }, 3, { obstacles: placementObstacles, segments, candidateMode: "expanded" }).map((box) => [box.id, box]));
  return callouts.map((callout) => {
    const metrics = sketchTextBox(callout.id, callout.kind, callout.text, callout.point);
    const box = placements.get(callout.id) ?? {
      id: metrics.id,
      x: metrics.anchorX,
      y: metrics.anchorY,
      width: metrics.width,
      height: metrics.height
    };
    return {
      ...callout,
      box,
      textPoint: { x: box.x + 4, y: box.y + sketchTextFontSize() },
      leaderPoint: sketchLeaderAnchor(box, callout.annotation?.visibilityEnd !== undefined && callout.annotation.evolutionEnd !== undefined
        ? pointFor(callout.annotation.visibilityEnd, callout.annotation.evolutionEnd, width, height)
        : undefined)
    };
  });
}

function renderSketchTextCallouts(callouts: readonly SketchCalloutPlacement[], width: number, height: number): string {
  return callouts.map((callout) => {
    const leader = callout.annotation?.visibilityEnd !== undefined && callout.annotation.evolutionEnd !== undefined
      ? `<path d="M${callout.leaderPoint.x},${callout.leaderPoint.y} C${callout.leaderPoint.x - 28},${callout.leaderPoint.y + 22} ${xFor(callout.annotation.evolutionEnd, width) + 22},${yFor(callout.annotation.visibilityEnd, height) - 20} ${xFor(callout.annotation.evolutionEnd, width)},${yFor(callout.annotation.visibilityEnd, height)}" fill="none" stroke="${callout.color}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" />`
      : "";
    const trigger = callout.kind === "annotation"
      ? `<circle class="wardley-callout-trigger" cx="${callout.point.x}" cy="${callout.point.y}" r="7" fill="#ffffff" fill-opacity="0.8" stroke="${callout.color}" stroke-width="2" stroke-dasharray="3 3" />`
      : "";
    return `<g data-wardley-callout-id="${escapeXml(callout.id)}" data-wardley-callout-kind="${callout.kind}">
    <g class="wardley-callout-trigger-layer">${leader}${trigger}</g>
    <g class="wardley-callout-body">${renderSketchNote(callout.kind, callout.text, callout.textPoint, callout.color, "wardley-sketch-callout")}</g>
  </g>`;
  }).join("\n  ");
}

function calloutRouteObstacles(callouts: readonly { readonly id: string; readonly box: PlacedTextBox }[]): readonly RouteObstacle[] {
  return callouts.map((callout) => ({
    id: callout.id,
    x: callout.box.x,
    y: callout.box.y,
    width: callout.box.width,
    height: callout.box.height,
    weight: 2
  }));
}

function linkMarkerAttributes(link: WardleyLink, markerId: string): string {
  if (link.kind === "dependency") {
    return "";
  }
  if (link.kind === "reverse-flow") {
    return `marker-start="url(#${markerId})"`;
  }
  if (link.kind === "bidirectional-flow") {
    return `marker-start="url(#${markerId})" marker-end="url(#${markerId})"`;
  }
  return `marker-end="url(#${markerId})"`;
}

function focusComponentAttributes(component: WardleyComponent): string {
  return `data-wardley-component-id="${escapeXml(component.id)}"`;
}

function focusLinkAttributes(edgeId: string, source: WardleyComponent, target: WardleyComponent): string {
  return `data-wardley-link-id="${escapeXml(edgeId)}" data-wardley-link-source="${escapeXml(source.id)}" data-wardley-link-target="${escapeXml(target.id)}"`;
}

function renderEdgeLabel(label: string, point: RenderPoint, colors: Record<string, string>, svgWidth: number, svgHeight: number): string {
  const text = layoutEdgeLabelText(label, "clean");
  const width = text.width + 12;
  const x = Math.max(MARGIN.left + 6, Math.min(point.x + 6, svgWidth - MARGIN.right - width - 8));
  const y = Math.max(MARGIN.top + 4, Math.min(point.y - 17, svgHeight - MARGIN.bottom - 24));
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="18" rx="4" fill="${colors.background}" fill-opacity="0.92" stroke="${colors.grid}" />
    <text x="${x + 6}" y="${y + 13}" fill="${colors.edge}" font-family="Inter, system-ui, sans-serif" font-size="${text.fontSize}" font-weight="600">${escapeXml(text.text)}</text>
  </g>`;
}

function renderSketchEdgeLabel(label: string, point: RenderPoint, colors: Record<string, string>, svgWidth: number, svgHeight: number): string {
  const text = layoutEdgeLabelText(label, "sketch");
  const width = text.width + 14;
  const x = Math.max(MARGIN.left + 6, Math.min(point.x + 8, svgWidth - MARGIN.right - width - 8));
  const y = Math.max(MARGIN.top + 6, Math.min(point.y - 22, svgHeight - MARGIN.bottom - 28));
  return `<g class="wardley-flow-label">
    <path d="M${x},${y + 5} C${x + width * 0.35},${y - 2} ${x + width * 0.68},${y + 2} ${x + width},${y + 4} L${x + width - 3},${y + 23} C${x + width * 0.64},${y + 27} ${x + width * 0.36},${y + 25} ${x + 2},${y + 23} Z" fill="${colors.paper ?? "#fffefd"}" fill-opacity="0.88" stroke="${colors.grid}" stroke-width="1" />
    <text x="${x + 7}" y="${y + 19}" fill="${colors.edge}" font-family="${sketchFont()}" font-size="${text.fontSize}" font-weight="700">${escapeXml(text.text)}</text>
  </g>`;
}

function renderCleanCalloutBox(text: string, kind: "annotation" | "note", stroke: string, box: PlacedTextBox): string {
  const label = layoutCalloutText(kind, text, "clean");
  const textLines = label.lines
    .map((line, index) => `<tspan x="${box.x + 12}" dy="${index === 0 ? 0 : label.lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<g>
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="6" fill="${stroke}" fill-opacity="0.1" stroke="${stroke}" />
    <text x="${box.x + 12}" y="${box.y + 19}" fill="${stroke}" font-family="Inter, system-ui, sans-serif" font-size="${label.fontSize}" font-weight="650">${textLines}</text>
  </g>`;
}

function renderSketchNote(kind: "annotation" | "note", text: string, point: RenderPoint, color: string, className?: string): string {
  const label = layoutCalloutText(kind, text, "sketch");
  return renderSketchMultilineText(label.text, point.x, point.y, color, label.fontSize, label.lineHeight, className);
}

function cleanTextBox(
  id: string,
  kind: "annotation" | "note",
  text: string,
  point: RenderPoint,
  svgWidth: number,
  svgHeight: number
): { readonly id: string; readonly anchorX: number; readonly anchorY: number; readonly width: number; readonly height: number } {
  const label = layoutCalloutText(kind, text, "clean");
  const width = Math.max(150, label.width + 24);
  const height = label.height + 18;
  return {
    id,
    anchorX: Math.max(MARGIN.left + 8, Math.min(point.x + 10, svgWidth - width - 16)),
    anchorY: Math.max(MARGIN.top + 8, Math.min(point.y - 26, svgHeight - MARGIN.bottom - height - 8)),
    width,
    height
  };
}

function renderCleanMultilineText(text: string, x: number, y: number, color: string, fontSize: number, lineHeight: number, fontWeight: number): string {
  const lines = text.split("\n");
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" fill="${color}" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}">${tspans}</text>`;
}

function renderSketchMultilineText(text: string, x: number, y: number, color: string, fontSize: number, lineHeight: number, className?: string): string {
  const lines = text.split("\n");
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text${className ? ` class="${className}"` : ""} x="${x}" y="${y}" fill="${color}" font-family="${sketchFont()}" font-size="${fontSize}" font-weight="650" paint-order="stroke" stroke="#fffefd" stroke-width="5" stroke-linejoin="round">${tspans}</text>`;
}

function renderSketchAxisLabel(text: string, x: number, y: number, color: string, lineHeight = 20): string {
  return renderSketchMultilineText(text, x, y, color, 18, lineHeight);
}

function sketchTextBox(id: string, kind: "annotation" | "note", text: string, point: RenderPoint): { readonly id: string; readonly anchorX: number; readonly anchorY: number; readonly width: number; readonly height: number } {
  const label = layoutCalloutText(kind, text, "sketch");
  return {
    id,
    anchorX: point.x - 4,
    anchorY: point.y - label.fontSize,
    width: label.width + 8,
    height: label.height
  };
}

function sketchTextFontSize(): number {
  return 19;
}

function sketchLeaderAnchor(box: Pick<PlacedTextBox, "x" | "y" | "width" | "height">, target?: RenderPoint | undefined): RenderPoint {
  const defaultY = box.y + sketchTextFontSize();
  if (!target) {
    return { x: box.x + 4, y: defaultY };
  }
  const rightward = target.x >= box.x + box.width / 2;
  return {
    x: rightward ? box.x + box.width : box.x + 4,
    y: Math.max(box.y + 6, Math.min(defaultY, box.y + box.height - 6))
  };
}

function attitudeBox(area: WardleyAttitudeArea, width: number, height: number): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const x1 = xFor(area.evolution, width);
  const y1 = yFor(area.visibility, height);
  if (area.evolutionEnd !== undefined && area.visibilityEnd !== undefined) {
    const x2 = xFor(area.evolutionEnd, width);
    const y2 = yFor(area.visibilityEnd, height);
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.max(22, Math.abs(x2 - x1)),
      height: Math.max(22, Math.abs(y2 - y1))
    };
  }
  return {
    x: x1,
    y: y1,
    width: area.width ?? 120,
    height: area.height ?? 30
  };
}

function sketchBlobPath(x: number, y: number, width: number, height: number, seed: number): string {
  const wobble = 6 + (seed % 3) * 3;
  const x0 = Math.round(x - wobble);
  const y0 = Math.round(y + height * 0.18);
  const x1 = Math.round(x + width * 0.18);
  const y1 = Math.round(y - wobble);
  const x2 = Math.round(x + width * 0.58);
  const y2 = Math.round(y + wobble * 0.4);
  const x3 = Math.round(x + width + wobble);
  const y3 = Math.round(y + height * 0.18);
  const x4 = Math.round(x + width - wobble * 0.8);
  const y4 = Math.round(y + height * 0.76);
  const x5 = Math.round(x + width * 0.58);
  const y5 = Math.round(y + height + wobble);
  const x6 = Math.round(x + width * 0.16);
  const y6 = Math.round(y + height - wobble * 0.4);
  const x7 = Math.round(x - wobble * 0.6);
  const y7 = Math.round(y + height * 0.66);
  return `M${x0},${y0} C${x - wobble},${y + height * 0.02} ${x1},${y - wobble} ${x2},${y2} C${x + width * 0.82},${y - wobble} ${x3},${y + height * 0.04} ${x3},${y3} C${x + width + wobble},${y + height * 0.45} ${x4},${y4} ${x5},${y5} C${x + width * 0.36},${y + height + wobble} ${x6},${y6} ${x7},${y7} C${x - wobble},${y + height * 0.45} ${x - wobble},${y + height * 0.28} ${x0},${y0} Z`;
}

function sketchFont(): string {
  return "'Comic Sans MS', 'Bradley Hand', 'Segoe Print', cursive, sans-serif";
}

function axisStagesFor(map: WardleyMap, notation: "clean" | "sketch"): readonly { readonly at: number; readonly label: string }[] {
  const labels = map.evolutionAxis?.labels;
  if (!labels || labels.length < 2) {
    return notation === "clean" ? CLEAN_AXIS_STAGES : SKETCH_AXIS_STAGES;
  }
  return labels.map((label, index) => ({
    at: index / labels.length,
    label
  }));
}

function componentFill(component: WardleyComponent, colors: Record<string, string>): string {
  if (component.pipelineId) {
    return colors.pipeline ?? "#d97706";
  }
  if (component.kind === "market") {
    return colors.market ?? "#b45309";
  }
  if (component.kind === "ecosystem") {
    return colors.ecosystem ?? "#047857";
  }
  return colors.component ?? "#0369a1";
}

function pointFor(visibility: number, evolution: number, width: number, height: number): RenderPoint {
  return {
    x: xFor(evolution, width),
    y: yFor(visibility, height)
  };
}

function shortenSegment(a: RenderPoint, b: RenderPoint, amount: number): { readonly a: RenderPoint; readonly b: RenderPoint } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= amount * 2) {
    return { a, b };
  }
  const unitX = dx / length;
  const unitY = dy / length;
  return {
    a: {
      x: Math.round(a.x + unitX * amount),
      y: Math.round(a.y + unitY * amount)
    },
    b: {
      x: Math.round(b.x - unitX * amount),
      y: Math.round(b.y - unitY * amount)
    }
  };
}

function quadraticPoint(a: RenderPoint, control: RenderPoint, b: RenderPoint, t: number): RenderPoint {
  const inverse = 1 - t;
  return {
    x: Math.round(inverse * inverse * a.x + 2 * inverse * t * control.x + t * t * b.x),
    y: Math.round(inverse * inverse * a.y + 2 * inverse * t * control.y + t * t * b.y)
  };
}

function xFor(evolution: number, width: number): number {
  return Math.round(MARGIN.left + evolution * (width - MARGIN.left - MARGIN.right));
}

function yFor(visibility: number, height: number): number {
  return Math.round(MARGIN.top + (1 - visibility) * (height - MARGIN.top - MARGIN.bottom));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
