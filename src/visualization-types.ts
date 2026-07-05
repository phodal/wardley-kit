export type VisualizationLayoutEngine = "dagre" | "elk";
export type VisualizationDirection = "TB" | "BT" | "LR" | "RL";

export interface VisualizationNode {
  readonly id: string;
  readonly label?: string | undefined;
  readonly kind?: string | undefined;
  readonly groupId?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface VisualizationEdge {
  readonly id?: string | undefined;
  readonly sourceId: string;
  readonly targetId: string;
  readonly label?: string | undefined;
  readonly kind?: string | undefined;
}

export interface VisualizationGroup {
  readonly id: string;
  readonly label?: string | undefined;
  readonly parentId?: string | undefined;
}

export interface VisualizationGraph {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly direction?: VisualizationDirection | undefined;
  readonly nodes: readonly VisualizationNode[];
  readonly edges: readonly VisualizationEdge[];
  readonly groups?: readonly VisualizationGroup[] | undefined;
}
