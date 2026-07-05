import type { Diagnostic, ParseOptions, SourceLocation } from "./core.js";

export type WardleyComponentKind = "component" | "anchor" | "submap" | "market" | "ecosystem";
export type WardleyLinkKind = "dependency" | "flow" | "reverse-flow" | "bidirectional-flow";
export type WardleyAttitudeKind = "pioneers" | "settlers" | "townplanners";
export type WardleyMethodKind = "build" | "buy" | "outsource";
export type WardleyMarkerKind = "accelerator" | "deaccelerator";

export interface WardleyPosition {
  readonly visibility: number;
  readonly evolution: number;
}

export interface WardleyLabelOffset {
  readonly x: number;
  readonly y: number;
}

export interface WardleyComponent {
  readonly id: string;
  readonly name: string;
  readonly kind: WardleyComponentKind;
  readonly visibility: number;
  readonly evolution: number;
  readonly label?: WardleyLabelOffset | undefined;
  readonly decorators: readonly string[];
  readonly inertia: boolean;
  readonly method?: WardleyMethodKind | undefined;
  readonly pipelineId?: string | undefined;
  readonly submapUrlId?: string | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyPipelineComponent {
  readonly name: string;
  readonly visibility: number;
  readonly evolution: number;
  readonly label?: WardleyLabelOffset | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyPipeline {
  readonly id: string;
  readonly name: string;
  readonly startEvolution?: number | undefined;
  readonly endEvolution?: number | undefined;
  readonly components: readonly WardleyPipelineComponent[];
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyEvolution {
  readonly sourceName: string;
  readonly targetName?: string | undefined;
  readonly evolution: number;
  readonly decorators: readonly string[];
  readonly label?: WardleyLabelOffset | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyLink {
  readonly sourceName: string;
  readonly targetName: string;
  readonly kind: WardleyLinkKind;
  readonly flowLabel?: string | undefined;
  readonly context?: string | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyAnnotation {
  readonly id: string;
  readonly text: string;
  readonly visibility: number;
  readonly evolution: number;
  readonly visibilityEnd?: number | undefined;
  readonly evolutionEnd?: number | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyNote {
  readonly text: string;
  readonly visibility: number;
  readonly evolution: number;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyUrl {
  readonly name: string;
  readonly url: string;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyAttitudeArea {
  readonly id: string;
  readonly kind: WardleyAttitudeKind;
  readonly visibility: number;
  readonly evolution: number;
  readonly visibilityEnd?: number | undefined;
  readonly evolutionEnd?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyMethod {
  readonly componentName: string;
  readonly method: WardleyMethodKind;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyMarker {
  readonly id: string;
  readonly name: string;
  readonly kind: WardleyMarkerKind;
  readonly visibility: number;
  readonly evolution: number;
  readonly label?: WardleyLabelOffset | undefined;
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyAxis {
  readonly labels: readonly string[];
  readonly sourceLocation?: SourceLocation | undefined;
}

export interface WardleyMap {
  readonly title: string;
  readonly style?: string | undefined;
  readonly size: {
    readonly width: number;
    readonly height: number;
  };
  readonly components: readonly WardleyComponent[];
  readonly links: readonly WardleyLink[];
  readonly evolutions: readonly WardleyEvolution[];
  readonly pipelines: readonly WardleyPipeline[];
  readonly annotations: readonly WardleyAnnotation[];
  readonly notes: readonly WardleyNote[];
  readonly urls: readonly WardleyUrl[];
  readonly attitudes: readonly WardleyAttitudeArea[];
  readonly methods: readonly WardleyMethod[];
  readonly markers: readonly WardleyMarker[];
  readonly annotationsLegend?: WardleyPosition | undefined;
  readonly evolutionAxis?: WardleyAxis | undefined;
  readonly yAxis?: WardleyAxis | undefined;
  readonly source?: string | undefined;
}

export interface WardleySummary {
  readonly componentCount: number;
  readonly linkCount: number;
  readonly evolutionCount: number;
  readonly pipelineCount: number;
  readonly annotationCount: number;
  readonly noteCount: number;
  readonly attitudeCount: number;
  readonly methodCount: number;
  readonly markerCount: number;
}

export interface WardleyParseOptions extends ParseOptions {
  readonly includeSource?: boolean | undefined;
}

export interface WardleyRenderOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly autoScale?: boolean | undefined;
  readonly theme?: "light" | "dark" | undefined;
  readonly notation?: "clean" | "sketch" | undefined;
}

export interface WardleyValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly map?: WardleyMap | undefined;
}
