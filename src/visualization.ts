import type { VisualizationGraph } from "./visualization-types.js";
import type { WardleyMap, WardleySummary } from "./types.js";

export function summarizeWardleyMap(map: WardleyMap): WardleySummary {
  return {
    componentCount: map.components.length,
    linkCount: map.links.length,
    evolutionCount: map.evolutions.length,
    pipelineCount: map.pipelines.length,
    annotationCount: map.annotations.length,
    noteCount: map.notes.length,
    attitudeCount: map.attitudes.length,
    methodCount: map.methods.length,
    markerCount: map.markers.length
  };
}

export function wardleyToVisualizationGraph(map: WardleyMap): VisualizationGraph {
  const componentIds = new Set(map.components.map((component) => component.id));
  const nodes = map.components.map((component) => ({
    id: component.id,
    label: component.name,
    kind: component.method ?? component.kind,
    groupId: component.pipelineId
  }));
  const pipelineGroups = map.pipelines.map((pipeline) => ({
    id: pipeline.id,
    label: `${pipeline.name} pipeline`
  }));
  const linkEdges = map.links.map((link, index) => ({
    id: `link-${index + 1}`,
    sourceId: componentId(link.sourceName),
    targetId: componentId(link.targetName),
    label: link.context ?? link.flowLabel,
    kind: link.kind
  }));
  const evolutionEdges = map.evolutions.map((evolution, index) => ({
    id: `evolve-${index + 1}`,
    sourceId: componentId(evolution.sourceName),
    targetId: evolution.targetName && componentIds.has(componentId(evolution.targetName))
      ? componentId(evolution.targetName)
      : componentId(evolution.sourceName),
    label: evolution.targetName ? `evolve to ${evolution.targetName}` : `evolve ${evolution.evolution}`,
    kind: "evolution"
  }));

  return {
    id: componentId(map.title),
    title: map.title,
    direction: "TB",
    nodes,
    edges: [...linkEdges, ...evolutionEdges],
    ...(pipelineGroups.length > 0 ? { groups: pipelineGroups } : {})
  };
}

function componentId(name: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return slug || `wardley-${hashString(name)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
