import type { WardleyMap } from "./types.js";

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 640;

export interface WardleyViewportOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly autoScale?: boolean | undefined;
}

export interface WardleyViewport {
  readonly width: number;
  readonly height: number;
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly scale: number;
  readonly autoScaled: boolean;
}

export function resolveWardleyViewport(map: WardleyMap, options: WardleyViewportOptions = {}): WardleyViewport {
  const baseWidth = options.width ?? map.size.width ?? DEFAULT_WIDTH;
  const baseHeight = options.height ?? map.size.height ?? DEFAULT_HEIGHT;
  const scale = options.autoScale ? wardleyAutoScaleFactor(map) : 1;
  const width = Math.round(baseWidth * scale);
  const height = Math.round(baseHeight * scale);
  return {
    width,
    height,
    baseWidth,
    baseHeight,
    scale,
    autoScaled: scale > 1.01
  };
}

export function wardleyAutoScaleFactor(map: WardleyMap): number {
  const nodePressure = map.components.length + map.markers.length * 0.6 + map.annotations.length * 0.35;
  const relationPressure = map.links.length + map.evolutions.length;
  const visibleOverlayPressure = map.markers.length + map.annotations.length + map.attitudes.length;
  const raw = 1
    + Math.max(0, nodePressure - 24) * 0.025
    + Math.max(0, relationPressure - nodePressure) * 0.006
    + Math.max(0, relationPressure - 36) * 0.006
    + Math.max(0, visibleOverlayPressure - 8) * 0.015;
  return Math.min(1.7, Math.max(1, Math.ceil(raw * 20) / 20));
}
