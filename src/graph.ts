import type {
  WardleyComponent,
  WardleyEvolution,
  WardleyLink,
  WardleyLinkKind,
  WardleyMap
} from "./types.js";

export type WardleyGraphEdgeKind = WardleyLinkKind | "evolution";
export type WardleyGraphRelationKind = "link" | "evolution";

export interface WardleyGraphNode {
  readonly id: string;
  readonly name: string;
  readonly component: WardleyComponent;
  readonly degree: number;
  readonly inDegree: number;
  readonly outDegree: number;
}

export interface WardleyGraphEdge {
  readonly id: string;
  readonly relation: WardleyGraphRelationKind;
  readonly kind: WardleyGraphEdgeKind;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly link?: WardleyLink | undefined;
  readonly evolution?: WardleyEvolution | undefined;
}

export interface WardleyGraphUnresolvedRelation {
  readonly id: string;
  readonly relation: WardleyGraphRelationKind;
  readonly sourceName: string;
  readonly targetName?: string | undefined;
}

export interface WardleyGraphNeighborhood {
  readonly componentIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface WardleyGraphPath {
  readonly componentIds: readonly string[];
  readonly componentNames: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface WardleyGraphPathResult {
  readonly paths: readonly WardleyGraphPath[];
  readonly truncated: boolean;
}

export type WardleyGraphTraversalMode = "adjacent" | "reachable";
export type WardleyGraphTraversalDirection = "incoming" | "outgoing" | "both";

export interface WardleyGraphNeighborhoodOptions {
  readonly traversal?: WardleyGraphTraversalMode | undefined;
  readonly direction?: WardleyGraphTraversalDirection | undefined;
}

export interface WardleyGraphPathOptions {
  readonly maxPaths?: number | undefined;
  readonly maxDepth?: number | undefined;
}

export interface WardleyGraph {
  readonly nodes: readonly WardleyGraphNode[];
  readonly edges: readonly WardleyGraphEdge[];
  readonly linkEdges: readonly WardleyGraphEdge[];
  readonly evolutionEdges: readonly WardleyGraphEdge[];
  readonly nodesById: ReadonlyMap<string, WardleyGraphNode>;
  readonly nodesByName: ReadonlyMap<string, WardleyGraphNode>;
  readonly edgesById: ReadonlyMap<string, WardleyGraphEdge>;
  readonly incomingByNodeId: ReadonlyMap<string, readonly WardleyGraphEdge[]>;
  readonly outgoingByNodeId: ReadonlyMap<string, readonly WardleyGraphEdge[]>;
  readonly incidentByNodeId: ReadonlyMap<string, readonly WardleyGraphEdge[]>;
  readonly unresolved: readonly WardleyGraphUnresolvedRelation[];
}

export function buildWardleyGraph(map: WardleyMap): WardleyGraph {
  const componentByName = new Map(map.components.map((component) => [normalizeName(component.name), component]));
  const edgeDrafts: WardleyGraphEdge[] = [];
  const unresolved: WardleyGraphUnresolvedRelation[] = [];

  map.links.forEach((link, index) => {
    const source = componentByName.get(normalizeName(link.sourceName));
    const target = componentByName.get(normalizeName(link.targetName));
    const id = `link-${index + 1}`;
    if (!source || !target) {
      unresolved.push({
        id,
        relation: "link",
        sourceName: link.sourceName,
        targetName: link.targetName
      });
      return;
    }
    edgeDrafts.push({
      id,
      relation: "link",
      kind: link.kind,
      sourceId: source.id,
      targetId: target.id,
      sourceName: source.name,
      targetName: target.name,
      link
    });
  });

  map.evolutions.forEach((evolution, index) => {
    const source = componentByName.get(normalizeName(evolution.sourceName));
    const target = evolution.targetName ? componentByName.get(normalizeName(evolution.targetName)) : undefined;
    const id = `evolution-${index + 1}`;
    if (!source) {
      unresolved.push({
        id,
        relation: "evolution",
        sourceName: evolution.sourceName,
        targetName: evolution.targetName
      });
      return;
    }
    edgeDrafts.push({
      id,
      relation: "evolution",
      kind: "evolution",
      sourceId: source.id,
      targetId: target?.id ?? source.id,
      sourceName: source.name,
      targetName: target?.name ?? evolution.targetName ?? source.name,
      evolution
    });
  });

  const incoming = new Map<string, WardleyGraphEdge[]>();
  const outgoing = new Map<string, WardleyGraphEdge[]>();
  const incident = new Map<string, WardleyGraphEdge[]>();
  for (const component of map.components) {
    incoming.set(component.id, []);
    outgoing.set(component.id, []);
    incident.set(component.id, []);
  }
  for (const edge of edgeDrafts) {
    outgoing.get(edge.sourceId)?.push(edge);
    incoming.get(edge.targetId)?.push(edge);
    incident.get(edge.sourceId)?.push(edge);
    if (edge.targetId !== edge.sourceId) {
      incident.get(edge.targetId)?.push(edge);
    }
  }

  const nodes = map.components.map((component) => ({
    id: component.id,
    name: component.name,
    component,
    degree: incident.get(component.id)?.length ?? 0,
    inDegree: incoming.get(component.id)?.length ?? 0,
    outDegree: outgoing.get(component.id)?.length ?? 0
  }));

  return {
    nodes,
    edges: edgeDrafts,
    linkEdges: edgeDrafts.filter((edge) => edge.relation === "link"),
    evolutionEdges: edgeDrafts.filter((edge) => edge.relation === "evolution"),
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    nodesByName: new Map(nodes.map((node) => [normalizeName(node.name), node])),
    edgesById: new Map(edgeDrafts.map((edge) => [edge.id, edge])),
    incomingByNodeId: freezeMapValues(incoming),
    outgoingByNodeId: freezeMapValues(outgoing),
    incidentByNodeId: freezeMapValues(incident),
    unresolved
  };
}

export function wardleyGraphNeighborhood(
  graph: WardleyGraph,
  seed: { readonly componentId?: string | undefined; readonly edgeId?: string | undefined },
  options: WardleyGraphNeighborhoodOptions = {}
): WardleyGraphNeighborhood {
  const componentIds = new Set<string>();
  const edgeIds = new Set<string>();
  const traversal = options.traversal ?? "adjacent";
  const direction = options.direction ?? "both";

  if (seed.edgeId) {
    const edge = graph.edgesById.get(seed.edgeId);
    if (edge) {
      edgeIds.add(edge.id);
      componentIds.add(edge.sourceId);
      componentIds.add(edge.targetId);
    }
  }

  if (seed.componentId) {
    componentIds.add(seed.componentId);
    if (traversal === "reachable") {
      addReachablePath(graph, seed.componentId, direction, componentIds, edgeIds);
    } else {
      addAdjacentEdges(graph, seed.componentId, componentIds, edgeIds);
    }
  }

  return {
    componentIds: [...componentIds],
    edgeIds: [...edgeIds]
  };
}

export function wardleyGraphPaths(
  graph: WardleyGraph,
  componentId: string,
  direction: Exclude<WardleyGraphTraversalDirection, "both">,
  options: WardleyGraphPathOptions = {}
): WardleyGraphPathResult {
  if (!graph.nodesById.has(componentId)) {
    return {
      paths: [],
      truncated: false
    };
  }

  const maxPaths = Math.max(1, options.maxPaths ?? 6);
  const maxDepth = Math.max(1, options.maxDepth ?? 12);
  const collectionLimit = maxPaths + 1;
  const paths: WardleyGraphPath[] = [];
  let truncated = false;
  const visited = new Set<string>([componentId]);

  function pushPath(componentIds: readonly string[], edgeIds: readonly string[]): void {
    if (paths.length >= collectionLimit) {
      truncated = true;
      return;
    }
    paths.push({
      componentIds,
      componentNames: componentIds.map((id) => graph.nodesById.get(id)?.name ?? id),
      edgeIds
    });
  }

  function visit(currentId: string, componentPath: string[], edgePath: string[], depth: number): void {
    if (paths.length >= collectionLimit) {
      truncated = true;
      return;
    }
    const edges = sortedEdges(direction === "incoming"
      ? graph.incomingByNodeId.get(currentId) ?? []
      : graph.outgoingByNodeId.get(currentId) ?? []);
    if (edges.length === 0 || depth >= maxDepth) {
      if (direction === "incoming") {
        pushPath([...componentPath].reverse(), [...edgePath].reverse());
      } else {
        pushPath([...componentPath], [...edgePath]);
      }
      truncated = truncated || (edges.length > 0 && depth >= maxDepth);
      return;
    }

    let expanded = false;
    for (const edge of edges) {
      const nextId = direction === "incoming" ? edge.sourceId : edge.targetId;
      if (visited.has(nextId)) {
        continue;
      }
      expanded = true;
      visited.add(nextId);
      componentPath.push(nextId);
      edgePath.push(edge.id);
      visit(nextId, componentPath, edgePath, depth + 1);
      edgePath.pop();
      componentPath.pop();
      visited.delete(nextId);
      if (paths.length >= collectionLimit) {
        truncated = true;
        return;
      }
    }
    if (!expanded) {
      if (direction === "incoming") {
        pushPath([...componentPath].reverse(), [...edgePath].reverse());
      } else {
        pushPath([...componentPath], [...edgePath]);
      }
    }
  }

  visit(componentId, [componentId], [], 0);
  return {
    paths: paths.slice(0, maxPaths),
    truncated: truncated || paths.length > maxPaths
  };
}

function addAdjacentEdges(
  graph: WardleyGraph,
  componentId: string,
  componentIds: Set<string>,
  edgeIds: Set<string>
): void {
  for (const edge of graph.incidentByNodeId.get(componentId) ?? []) {
    edgeIds.add(edge.id);
    componentIds.add(edge.sourceId);
    componentIds.add(edge.targetId);
  }
}

function addReachablePath(
  graph: WardleyGraph,
  componentId: string,
  direction: WardleyGraphTraversalDirection,
  componentIds: Set<string>,
  edgeIds: Set<string>
): void {
  if (direction === "incoming" || direction === "both") {
    addDirectedReachablePath(graph, componentId, "incoming", componentIds, edgeIds);
  }
  if (direction === "outgoing" || direction === "both") {
    addDirectedReachablePath(graph, componentId, "outgoing", componentIds, edgeIds);
  }
}

function addDirectedReachablePath(
  graph: WardleyGraph,
  componentId: string,
  direction: Exclude<WardleyGraphTraversalDirection, "both">,
  componentIds: Set<string>,
  edgeIds: Set<string>
): void {
  const visited = new Set<string>([componentId]);
  const queue = [componentId];

  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index]!;
    const edges = direction === "incoming"
      ? graph.incomingByNodeId.get(currentId) ?? []
      : graph.outgoingByNodeId.get(currentId) ?? [];
    for (const edge of edges) {
      edgeIds.add(edge.id);
      componentIds.add(edge.sourceId);
      componentIds.add(edge.targetId);
      const nextId = direction === "incoming" ? edge.sourceId : edge.targetId;
      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function sortedEdges(edges: readonly WardleyGraphEdge[]): readonly WardleyGraphEdge[] {
  return [...edges].sort((left, right) => {
    const leftName = `${left.sourceName}->${left.targetName}`;
    const rightName = `${right.sourceName}->${right.targetName}`;
    return leftName.localeCompare(rightName);
  });
}

function freezeMapValues(map: Map<string, WardleyGraphEdge[]>): ReadonlyMap<string, readonly WardleyGraphEdge[]> {
  return new Map([...map.entries()].map(([key, value]) => [key, Object.freeze([...value])]));
}
