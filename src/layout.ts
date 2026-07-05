import type {
  WardleyAnnotation,
  WardleyComponent,
  WardleyMap,
  WardleyMarker,
  WardleyRenderOptions
} from "./types.js";
import { quadraticRouteSegments, routeQuadraticSegment, type RouteObstacle } from "./path-routing.js";
import { buildWardleyGraph, type WardleyGraph } from "./graph.js";
import { placeTextBoxes, type PlacedTextBox, type TextPlacementBox, type TextPlacementSegment } from "./text-placement.js";
import {
  layoutCalloutText,
  layoutComponentLabelText,
  layoutMarkerLabelText,
  layoutWardleyTitleText
} from "./text-layout.js";
import { resolveWardleyViewport } from "./viewport.js";

const MARGIN = { top: 108, right: 48, bottom: 76, left: 96 };

export type WardleyLayoutBoxKind =
  | "annotation"
  | "component-label"
  | "component-node"
  | "marker-label"
  | "marker-node"
  | "note";

export type WardleyLayoutSegmentKind = "annotation" | "evolution" | "link";

export type WardleyLayoutDiagnosticCode =
  | "S4WARDLEY_LAYOUT_LABEL_OVERLAP"
  | "S4WARDLEY_LAYOUT_LINK_LABEL_INTERSECTION"
  | "S4WARDLEY_LAYOUT_LINK_NODE_INTERSECTION"
  | "S4WARDLEY_LAYOUT_NODE_OVERLAP"
  | "S4WARDLEY_LAYOUT_TEXT_TRUNCATED";

export interface WardleyLayoutOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly autoScale?: boolean | undefined;
  readonly notation?: WardleyRenderOptions["notation"] | undefined;
  readonly padding?: number | undefined;
  readonly autoPlaceLabels?: boolean | undefined;
  readonly autoRouteLinks?: boolean | undefined;
}

export interface WardleyLayoutBox {
  readonly id: string;
  readonly kind: WardleyLayoutBoxKind;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly componentId?: string | undefined;
  readonly fullLabel?: string | undefined;
  readonly truncated?: boolean | undefined;
}

export interface WardleyLayoutSegment {
  readonly id: string;
  readonly kind: WardleyLayoutSegmentKind;
  readonly label: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly sourceComponentId?: string | undefined;
  readonly targetComponentId?: string | undefined;
  readonly ignoredBoxIds?: readonly string[] | undefined;
}

export interface WardleyLayoutDiagnostic {
  readonly code: WardleyLayoutDiagnosticCode;
  readonly severity: "warning";
  readonly message: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
}

export interface WardleyLayoutReport {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly WardleyLayoutBox[];
  readonly segments: readonly WardleyLayoutSegment[];
  readonly diagnostics: readonly WardleyLayoutDiagnostic[];
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface TextCalloutSpec {
  readonly id: string;
  readonly kind: "annotation" | "note";
  readonly text: string;
  readonly point: Point;
}

interface ComponentLabelSpec {
  readonly component: WardleyComponent;
  readonly point: Point;
}

export function analyzeWardleyLayout(map: WardleyMap, options: WardleyLayoutOptions = {}): WardleyLayoutReport {
  const { width, height } = resolveWardleyViewport(map, options);
  const notation = resolveNotation(map, options);
  const padding = options.padding ?? 2;
  const boxes: WardleyLayoutBox[] = [];
  const segments: WardleyLayoutSegment[] = [];
  const componentLabelSpecs: ComponentLabelSpec[] = [];
  const graph = buildWardleyGraph(map);

  for (const component of map.components) {
    const point = pointFor(component.visibility, component.evolution, width, height);
    boxes.push(componentNodeBox(component, point, notation));
    componentLabelSpecs.push({ component, point });
  }

  for (const marker of map.markers) {
    const point = pointFor(marker.visibility, marker.evolution, width, height);
    boxes.push(markerNodeBox(marker, point));
    boxes.push(markerLabelBox(marker, point, notation));
  }

  for (const edge of graph.linkEdges) {
    const source = graph.nodesById.get(edge.sourceId)?.component;
    const target = graph.nodesById.get(edge.targetId)?.component;
    if (!source || !target) {
      continue;
    }
    const shortened = shortenSegment(
      pointFor(source.visibility, source.evolution, width, height),
      pointFor(target.visibility, target.evolution, width, height),
      notation === "sketch" ? 17 : 12
    );
    segments.push({
      id: edge.id,
      kind: "link",
      label: `${source.name} -> ${target.name}`,
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
      kind: "evolution",
      label: evolution?.targetName ? `${source.name} evolves to ${evolution.targetName}` : `${source.name} evolves`,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      sourceComponentId: source.id,
      targetComponentId: edge.targetId
    });
  }

  const callouts: TextCalloutSpec[] = [
    ...map.notes.map((note, index) => ({
      id: `note-${index + 1}`,
      kind: "note" as const,
      text: note.text,
      point: pointFor(note.visibility, note.evolution, width, height)
    })),
    ...map.annotations.map((annotation) => ({
      id: `annotation-${annotation.id}`,
      kind: "annotation" as const,
      text: `${annotation.id}. ${annotation.text}`,
      point: pointFor(annotation.visibility, annotation.evolution, width, height)
    }))
  ];
  const placementSegments = [
    ...segments,
    ...annotationPlacementSegments(map.annotations, width, height)
  ];

  boxes.push(...(options.autoPlaceLabels === false
    ? componentLabelSpecs.map((spec) => componentLabelBox(spec.component, spec.point, notation))
    : placeComponentLabelBoxes(componentLabelSpecs, width, height, notation, boxes, placementSegments, map.title, graph)));
  const calloutBoxes = textCalloutBoxes(callouts, width, height, notation, boxes, placementSegments);
  boxes.push(...calloutBoxes);
  const annotationByBoxId = new Map(map.annotations.map((annotation) => [`annotation-${annotation.id}`, annotation]));
  const calloutAnchors = new Map(calloutBoxes.map((box) => {
    const annotation = annotationByBoxId.get(box.id);
    const end = annotation?.visibilityEnd !== undefined && annotation.evolutionEnd !== undefined
      ? pointFor(annotation.visibilityEnd, annotation.evolutionEnd, width, height)
      : undefined;
    return [box.id, notation === "sketch" ? sketchLeaderAnchor(box, end) : { x: box.x, y: box.y }];
  }));

  map.annotations.forEach((annotation, index) => {
    const point = pointFor(annotation.visibility, annotation.evolution, width, height);
    if (annotation.visibilityEnd !== undefined && annotation.evolutionEnd !== undefined) {
      const end = pointFor(annotation.visibilityEnd, annotation.evolutionEnd, width, height);
      const start = notation === "sketch" ? calloutAnchors.get(`annotation-${annotation.id}`) ?? point : point;
      segments.push({
        id: `annotation-${index + 1}`,
        kind: "annotation",
        label: `annotation ${annotation.id}`,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        ignoredBoxIds: [`annotation-${annotation.id}`]
      });
    }
  });

  const routedSegments = options.autoRouteLinks === false ? segments : routeLayoutSegments(segments, boxes, padding);

  return {
    width,
    height,
    boxes,
    segments: routedSegments,
    diagnostics: buildDiagnostics(boxes, routedSegments, padding)
  };
}

function resolveNotation(map: WardleyMap, options: WardleyLayoutOptions): "clean" | "sketch" {
  if (options.notation) {
    return options.notation;
  }
  const style = map.style?.toLowerCase() ?? "";
  return style === "wardley" || style.includes("sketch") || style.includes("hand") ? "sketch" : "clean";
}

function buildDiagnostics(
  boxes: readonly WardleyLayoutBox[],
  segments: readonly WardleyLayoutSegment[],
  padding: number
): readonly WardleyLayoutDiagnostic[] {
  const diagnostics: WardleyLayoutDiagnostic[] = [];
  const segmentDiagnosticKeys = new Set<string>();
  const labelBoxes = boxes.filter((box) => box.kind.endsWith("label") || box.kind === "note" || box.kind === "annotation");
  const nodeBoxes = boxes.filter((box) => box.kind.endsWith("node"));

  for (const box of labelBoxes) {
    if (box.truncated) {
      diagnostics.push(diagnostic(
        "S4WARDLEY_LAYOUT_TEXT_TRUNCATED",
        box,
        box,
        "Text was truncated to fit the map; the full content is still preserved in the source."
      ));
    }
  }

  for (let index = 0; index < labelBoxes.length; index += 1) {
    const source = labelBoxes[index]!;
    for (let nextIndex = index + 1; nextIndex < labelBoxes.length; nextIndex += 1) {
      const target = labelBoxes[nextIndex]!;
      if (source.componentId && source.componentId === target.componentId) {
        continue;
      }
      if (boxesOverlap(source, target, padding)) {
        diagnostics.push(diagnostic(
          "S4WARDLEY_LAYOUT_LABEL_OVERLAP",
          source,
          target,
          `Label "${source.label}" overlaps "${target.label}".`
        ));
      }
    }
  }

  for (let index = 0; index < nodeBoxes.length; index += 1) {
    const source = nodeBoxes[index]!;
    for (let nextIndex = index + 1; nextIndex < nodeBoxes.length; nextIndex += 1) {
      const target = nodeBoxes[nextIndex]!;
      if (source.componentId && source.componentId === target.componentId) {
        continue;
      }
      if (boxesOverlap(source, target, 0)) {
        diagnostics.push(diagnostic(
          "S4WARDLEY_LAYOUT_NODE_OVERLAP",
          source,
          target,
          `Node "${source.label}" overlaps "${target.label}".`
        ));
      }
    }
  }

  for (const segment of segments) {
    for (const box of labelBoxes) {
      if (segment.ignoredBoxIds?.includes(box.id)) {
        continue;
      }
      if (isEndpointComponent(segment, box.componentId)) {
        continue;
      }
      if (segmentIntersectsBox(segment, box, padding)) {
        pushSegmentDiagnostic(diagnostics, segmentDiagnosticKeys, segmentDiagnostic(
          "S4WARDLEY_LAYOUT_LINK_LABEL_INTERSECTION",
          segment,
          box,
          `Line "${segment.label}" intersects label "${box.label}".`
        ));
      }
    }
    for (const box of nodeBoxes) {
      if (segment.ignoredBoxIds?.includes(box.id)) {
        continue;
      }
      if (isEndpointComponent(segment, box.componentId)) {
        continue;
      }
      if (segmentIntersectsBox(segment, box, padding)) {
        pushSegmentDiagnostic(diagnostics, segmentDiagnosticKeys, segmentDiagnostic(
          "S4WARDLEY_LAYOUT_LINK_NODE_INTERSECTION",
          segment,
          box,
          `Line "${segment.label}" intersects node "${box.label}".`
        ));
      }
    }
  }

  return diagnostics;
}

function diagnostic(
  code: WardleyLayoutDiagnosticCode,
  source: WardleyLayoutBox,
  target: WardleyLayoutBox,
  message: string
): WardleyLayoutDiagnostic {
  return {
    code,
    severity: "warning",
    message,
    sourceId: source.id,
    targetId: target.id,
    sourceLabel: source.label,
    targetLabel: target.label
  };
}

function segmentDiagnostic(
  code: WardleyLayoutDiagnosticCode,
  segment: WardleyLayoutSegment,
  target: WardleyLayoutBox,
  message: string
): WardleyLayoutDiagnostic {
  return {
    code,
    severity: "warning",
    message,
    sourceId: segment.id,
    targetId: target.id,
    sourceLabel: segment.label,
    targetLabel: target.label
  };
}

function pushSegmentDiagnostic(
  diagnostics: WardleyLayoutDiagnostic[],
  keys: Set<string>,
  diagnostic: WardleyLayoutDiagnostic
): void {
  const sourceId = diagnostic.sourceId.replace(/:\d+$/u, "");
  const key = `${diagnostic.code}:${sourceId}:${diagnostic.targetId}`;
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  diagnostics.push({
    ...diagnostic,
    sourceId
  });
}

function isEndpointComponent(segment: WardleyLayoutSegment, componentId: string | undefined): boolean {
  return componentId !== undefined && (segment.sourceComponentId === componentId || segment.targetComponentId === componentId);
}

function routeLayoutSegments(
  segments: readonly WardleyLayoutSegment[],
  boxes: readonly WardleyLayoutBox[],
  padding: number
): readonly WardleyLayoutSegment[] {
  const obstacles = boxes.map(routeObstacleForBox);
  return segments.flatMap((segment, index) => {
    if (segment.kind !== "link" && segment.kind !== "annotation") {
      return [segment];
    }
    const curve = routeQuadraticSegment(
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
      {
        obstacles,
        ignoredObstacleIds: segment.ignoredBoxIds,
        ignoredComponentIds: [segment.sourceComponentId, segment.targetComponentId].filter((id): id is string => id !== undefined),
        padding: padding + 2,
        bendDirection: index % 2 === 0 ? 1 : -1
      }
    );
    return quadraticRouteSegments(curve).map(([start, end], pieceIndex) => ({
      ...segment,
      id: `${segment.id}:${pieceIndex + 1}`,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y
    }));
  });
}

function routeObstacleForBox(box: WardleyLayoutBox): RouteObstacle {
  return {
    id: box.id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    weight: box.kind.endsWith("node") ? 4 : 1,
    ...(box.componentId ? { componentId: box.componentId } : {})
  };
}

function annotationPlacementSegments(
  annotations: readonly WardleyAnnotation[],
  width: number,
  height: number
): readonly WardleyLayoutSegment[] {
  return annotations.flatMap((annotation, index) => {
    if (annotation.visibilityEnd === undefined || annotation.evolutionEnd === undefined) {
      return [];
    }
    const start = pointFor(annotation.visibility, annotation.evolution, width, height);
    const end = pointFor(annotation.visibilityEnd, annotation.evolutionEnd, width, height);
    return [{
      id: `annotation-${index + 1}`,
      kind: "annotation" as const,
      label: `annotation ${annotation.id}`,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      ignoredBoxIds: [`annotation-${annotation.id}`]
    }];
  });
}

function componentNodeBox(component: WardleyComponent, point: Point, notation: "clean" | "sketch"): WardleyLayoutBox {
  if (component.kind === "anchor" && notation === "sketch") {
    return {
      id: `component-node:${component.id}`,
      kind: "component-node",
      label: component.name,
      x: point.x - 19,
      y: point.y - 47,
      width: 38,
      height: 81,
      componentId: component.id
    };
  }
  const radius = component.kind === "anchor"
    ? 14
    : notation === "sketch" ? 15 : 9;
  return {
    id: `component-node:${component.id}`,
    kind: "component-node",
    label: component.name,
    x: point.x - radius,
    y: point.y - radius,
    width: radius * 2,
    height: radius * 2,
    componentId: component.id
  };
}

function componentLabelBox(component: WardleyComponent, point: Point, notation: "clean" | "sketch"): WardleyLayoutBox {
  const metrics = componentLabelMetrics(component, point, notation);
  return {
    id: metrics.id,
    kind: "component-label",
    label: metrics.text,
    x: metrics.x,
    y: metrics.y,
    width: metrics.width,
    height: metrics.height,
    componentId: component.id,
    fullLabel: metrics.fullLabel,
    truncated: metrics.truncated
  };
}

function placeComponentLabelBoxes(
  specs: readonly ComponentLabelSpec[],
  svgWidth: number,
  svgHeight: number,
  notation: "clean" | "sketch",
  obstacles: readonly WardleyLayoutBox[],
  segments: readonly WardleyLayoutSegment[],
  title: string,
  graph: WardleyGraph
): readonly WardleyLayoutBox[] {
  const labelAvoidanceSegments = [
    ...segments,
    ...routedLabelAvoidanceSegments(segments, obstacles, notation)
  ];
  const placementSegments: readonly TextPlacementSegment[] = labelAvoidanceSegments.map((segment) => ({
    id: segment.id,
    x1: segment.x1,
    y1: segment.y1,
    x2: segment.x2,
    y2: segment.y2
  }));
  const orderedSpecs = orderComponentLabelSpecs(specs, graph);
  const pinnedSpecs = orderedSpecs.filter((spec) => shouldPinSketchComponentLabel(spec.component, notation, graph));
  const pinnedBoxes: readonly PlacedTextBox[] = pinnedSpecs.map((spec) => {
    const metrics = componentLabelMetrics(spec.component, spec.point, notation);
    return {
      id: spec.component.id,
      x: metrics.x,
      y: metrics.y,
      width: metrics.width,
      height: metrics.height
    };
  });
  const placementSpecs = orderedSpecs.filter((spec) => !shouldPinSketchComponentLabel(spec.component, notation, graph));
  const placementBoxes: readonly TextPlacementBox[] = placementSpecs.map((spec) => {
    const metrics = componentLabelMetrics(spec.component, spec.point, notation);
    const centeredAnchorLabel = notation === "sketch"
      && spec.component.kind === "anchor"
      && (!spec.component.label || shouldCenterDetachedAnchorLabel(spec.component));
    const ignoredObstacleIds = centeredAnchorLabel ? [] : [`component-node:${spec.component.id}`];
    return {
      id: spec.component.id,
      anchorX: metrics.x,
      anchorY: metrics.y,
      width: metrics.width,
      height: metrics.height,
      ignoredObstacleIds,
      ignoredSegmentIds: labelAvoidanceSegments
        .filter((segment) => isEndpointComponent(segment, spec.component.id))
        .map((segment) => segment.id)
    };
  });
  const bounds = {
    left: 16,
    top: Math.max(8, MARGIN.top - 60),
    right: svgWidth - 16,
    bottom: svgHeight - MARGIN.bottom - 8
  };
  const placementObstacles = title ? [titleObstacle(title, notation), ...obstacles, ...pinnedBoxes] : [...obstacles, ...pinnedBoxes];
  const placements = new Map(placeTextBoxes(placementBoxes, bounds, 4, {
    obstacles: placementObstacles,
    segments: placementSegments,
    candidateMode: shouldUseGraphPriorityLabelOrder(graph) ? "expanded" : "local"
  }).map((box) => [box.id, box]));
  for (const box of pinnedBoxes) {
    placements.set(box.id, box);
  }
  return orderedSpecs.map((spec) => {
    const metrics = componentLabelMetrics(spec.component, spec.point, notation);
    const box = placements.get(spec.component.id) ?? {
      id: metrics.id,
      x: metrics.x,
      y: metrics.y,
      width: metrics.width,
      height: metrics.height
    };
    return {
      id: metrics.id,
      kind: "component-label",
      label: metrics.text,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      componentId: spec.component.id,
      fullLabel: metrics.fullLabel,
      truncated: metrics.truncated
    };
  });
}

function orderComponentLabelSpecs(specs: readonly ComponentLabelSpec[], graph: WardleyGraph): readonly ComponentLabelSpec[] {
  if (!shouldUseGraphPriorityLabelOrder(graph)) {
    return specs;
  }
  const originalIndex = new Map(specs.map((spec, index) => [spec.component.id, index]));
  return [...specs].sort((a, b) => {
    const priority = componentLabelPriority(b.component, graph) - componentLabelPriority(a.component, graph);
    if (priority !== 0) {
      return priority;
    }
    return (originalIndex.get(a.component.id) ?? 0) - (originalIndex.get(b.component.id) ?? 0);
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

function routedLabelAvoidanceSegments(
  segments: readonly WardleyLayoutSegment[],
  obstacles: readonly WardleyLayoutBox[],
  notation: "clean" | "sketch"
): readonly WardleyLayoutSegment[] {
  const routeObstacles = obstacles.map(routeObstacleForBox);
  return segments.flatMap((segment, index) => {
    if (segment.kind !== "link" || !segment.sourceComponentId || !segment.targetComponentId) {
      return [];
    }
    const curve = routeQuadraticSegment(
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
      {
        obstacles: routeObstacles,
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

function titleObstacle(title: string, notation: "clean" | "sketch"): PlacedTextBox {
  const displayTitle = layoutWardleyTitleText(title, notation);
  return {
    id: "map-title",
    x: MARGIN.left - 8,
    y: 0,
    width: displayTitle.width + 22,
    height: MARGIN.top - 12
  };
}

function componentLabelMetrics(component: WardleyComponent, point: Point, notation: "clean" | "sketch"): { readonly id: string; readonly text: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fullLabel: string; readonly truncated: boolean } {
  const label = component.label ?? (notation === "sketch"
    ? component.kind === "anchor" ? { x: -48, y: -54 } : { x: 15, y: 6 }
    : { x: 12, y: -12 });
  const text = layoutComponentLabelText(component, notation);
  if (notation === "sketch" && component.kind === "anchor" && (!component.label || shouldCenterDetachedAnchorLabel(component))) {
    const labelX = point.x - text.width / 2;
    const labelY = point.y - 62 - ((text.lines.length - 1) * text.lineHeight);
    return {
      id: `component-label:${component.id}`,
      text: text.text,
      x: labelX - 4,
      y: labelY - text.fontSize,
      width: Math.max(18, text.width + 8),
      height: Math.max(18, text.height),
      fullLabel: text.rawText,
      truncated: text.truncated
    };
  }
  if (notation === "sketch" && shouldCenterDetachedTopLabel(component)) {
    const labelX = point.x - text.width / 2;
    const labelY = point.y - 26 - ((text.lines.length - 1) * text.lineHeight);
    return {
      id: `component-label:${component.id}`,
      text: text.text,
      x: labelX - 4,
      y: labelY - text.fontSize,
      width: Math.max(18, text.width + 8),
      height: Math.max(18, text.height),
      fullLabel: text.rawText,
      truncated: text.truncated
    };
  }
  const labelX = point.x + label.x;
  const labelY = point.y + label.y;
  return {
    id: `component-label:${component.id}`,
    text: text.text,
    x: label.x < 0 ? labelX - 5 : labelX - 4,
    y: notation === "sketch" ? labelY - text.fontSize : labelY - 13,
    width: Math.max(18, text.width + 8),
    height: Math.max(18, text.height),
    fullLabel: text.rawText,
    truncated: text.truncated
  };
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

function markerNodeBox(marker: WardleyMarker, point: Point): WardleyLayoutBox {
  return {
    id: `marker-node:${marker.id}`,
    kind: "marker-node",
    label: marker.name,
    x: point.x - 12,
    y: point.y - 12,
    width: 24,
    height: 24
  };
}

function markerLabelBox(marker: WardleyMarker, point: Point, notation: "clean" | "sketch"): WardleyLayoutBox {
  const label = marker.label ?? { x: 14, y: -10 };
  const text = layoutMarkerLabelText(marker, notation);
  const labelX = point.x + label.x;
  const labelY = point.y + label.y;
  return {
    id: `marker-label:${marker.id}`,
    kind: "marker-label",
    label: text.text,
    x: labelX - 4,
    y: labelY - text.fontSize,
    width: text.width + 8,
    height: text.height + 1,
    fullLabel: text.rawText,
    truncated: text.truncated
  };
}

function textCalloutBoxes(
  callouts: readonly TextCalloutSpec[],
  svgWidth: number,
  svgHeight: number,
  notation: "clean" | "sketch",
  obstacles: readonly WardleyLayoutBox[] = [],
  segments: readonly WardleyLayoutSegment[] = []
): readonly WardleyLayoutBox[] {
  if (notation === "sketch") {
    const placementBoxes = callouts.map((callout) => sketchTextBox(callout.id, callout.kind, callout.text, callout.point));
    const placementObstacles: readonly PlacedTextBox[] = obstacles.map((box) => ({
      id: box.id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    }));
    const placementSegments: readonly TextPlacementSegment[] = segments.map((segment) => ({
      id: segment.id,
      x1: segment.x1,
      y1: segment.y1,
      x2: segment.x2,
      y2: segment.y2
    }));
    const placements = new Map(placeTextBoxes(placementBoxes, {
      left: MARGIN.left - 24,
      top: MARGIN.top - 48,
      right: svgWidth - 16,
      bottom: svgHeight - MARGIN.bottom - 8
    }, 3, { obstacles: placementObstacles, segments: placementSegments, candidateMode: "expanded" }).map((box) => [box.id, box]));
    return callouts.map((callout) => {
      const metrics = sketchTextBox(callout.id, callout.kind, callout.text, callout.point);
      const label = layoutCalloutText(callout.kind, callout.text, notation);
      const box = placements.get(callout.id) ?? {
        id: metrics.id,
        x: metrics.anchorX,
        y: metrics.anchorY,
        width: metrics.width,
        height: metrics.height
      };
      return {
        id: callout.id,
        kind: callout.kind,
        label: label.text,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        fullLabel: callout.text,
        truncated: label.truncated
      };
    });
  }
  const placementBoxes = callouts.map((callout) => cleanTextBox(callout.id, callout.kind, callout.text, callout.point, svgWidth, svgHeight));
  const placementObstacles: readonly PlacedTextBox[] = obstacles.map((box) => ({
    id: box.id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height
  }));
  const placementSegments: readonly TextPlacementSegment[] = segments.map((segment) => ({
    id: segment.id,
    x1: segment.x1,
    y1: segment.y1,
    x2: segment.x2,
    y2: segment.y2
  }));
  const placements = new Map(placeTextBoxes(placementBoxes, {
    left: MARGIN.left + 8,
    top: MARGIN.top + 8,
    right: svgWidth - 16,
    bottom: svgHeight - MARGIN.bottom - 8
  }, 3, { obstacles: placementObstacles, segments: placementSegments, candidateMode: "expanded" }).map((box) => [box.id, box]));
  return callouts.map((callout) => {
    const metrics = cleanTextBox(callout.id, callout.kind, callout.text, callout.point, svgWidth, svgHeight);
    const label = layoutCalloutText(callout.kind, callout.text, notation);
    const box = placements.get(callout.id) ?? {
      id: metrics.id,
      x: metrics.anchorX,
      y: metrics.anchorY,
      width: metrics.width,
      height: metrics.height
    };
    return {
      id: callout.id,
      kind: callout.kind,
      label: label.text,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      fullLabel: `${callout.kind}: ${callout.text}`,
      truncated: label.truncated
    };
  });
}

function cleanTextBox(
  id: string,
  kind: "annotation" | "note",
  text: string,
  point: Point,
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

function sketchTextBox(id: string, kind: "annotation" | "note", text: string, point: Point): { readonly id: string; readonly anchorX: number; readonly anchorY: number; readonly width: number; readonly height: number } {
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

function sketchLeaderAnchor(box: Pick<WardleyLayoutBox, "x" | "y" | "width" | "height">, target?: Point | undefined): Point {
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

function pointFor(visibility: number, evolution: number, width: number, height: number): Point {
  return {
    x: Math.round(MARGIN.left + evolution * (width - MARGIN.left - MARGIN.right)),
    y: Math.round(MARGIN.top + (1 - visibility) * (height - MARGIN.top - MARGIN.bottom))
  };
}

function shortenSegment(a: Point, b: Point, amount: number): { readonly a: Point; readonly b: Point } {
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

function boxesOverlap(a: WardleyLayoutBox, b: WardleyLayoutBox, padding: number): boolean {
  const ax = a.x - padding;
  const ay = a.y - padding;
  const bx = b.x - padding;
  const by = b.y - padding;
  return ax < bx + b.width + padding * 2
    && ax + a.width + padding * 2 > bx
    && ay < by + b.height + padding * 2
    && ay + a.height + padding * 2 > by;
}

function segmentIntersectsBox(segment: WardleyLayoutSegment, box: WardleyLayoutBox, padding: number): boolean {
  const left = box.x - padding;
  const right = box.x + box.width + padding;
  const top = box.y - padding;
  const bottom = box.y + box.height + padding;
  const a = { x: segment.x1, y: segment.y1 };
  const b = { x: segment.x2, y: segment.y2 };
  if (pointInBox(a, left, right, top, bottom) || pointInBox(b, left, right, top, bottom)) {
    return true;
  }
  return lineSegmentsIntersect(a, b, { x: left, y: top }, { x: right, y: top })
    || lineSegmentsIntersect(a, b, { x: right, y: top }, { x: right, y: bottom })
    || lineSegmentsIntersect(a, b, { x: right, y: bottom }, { x: left, y: bottom })
    || lineSegmentsIntersect(a, b, { x: left, y: bottom }, { x: left, y: top });
}

function pointInBox(point: Point, left: number, right: number, top: number, bottom: number): boolean {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function lineSegmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && onSegment(a, c, b)) return true;
  if (abD === 0 && onSegment(a, d, b)) return true;
  if (cdA === 0 && onSegment(c, a, d)) return true;
  if (cdB === 0 && onSegment(c, b, d)) return true;
  return abC !== abD && cdA !== cdB;
}

function orientation(a: Point, b: Point, c: Point): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return b.x <= Math.max(a.x, c.x)
    && b.x >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y)
    && b.y >= Math.min(a.y, c.y);
}
