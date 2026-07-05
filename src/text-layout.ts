import type { WardleyComponent, WardleyMarker } from "./types.js";
import { layoutTextBlock, type TextBlockLayout } from "./text.js";

export type WardleyTextNotation = "clean" | "sketch";
export type WardleyCalloutKind = "annotation" | "note";

export interface WardleyVisibleText extends TextBlockLayout {
  readonly rawText: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

const CLEAN_TITLE_LIMIT = { width: 760, lines: 1, fontSize: 24, lineHeight: 30, fontWeight: 700 };
const SKETCH_TITLE_LIMIT = { width: 760, lines: 1, fontSize: 28, lineHeight: 34, fontWeight: 700 };
const CLEAN_COMPONENT_LIMIT = { width: 210, lines: 2, fontSize: 12, lineHeight: 15, fontWeight: 650 };
const SKETCH_COMPONENT_LIMIT = { width: 190, lines: 3, fontSize: 16, lineHeight: 18, fontWeight: 650 };
const SKETCH_COMPONENT_MEDIUM_LIMIT = { width: 190, lines: 4, fontSize: 16, lineHeight: 18, fontWeight: 650 };
const SKETCH_ANCHOR_LIMIT = { width: 220, lines: 2, fontSize: 18, lineHeight: 18, fontWeight: 650 };
const CLEAN_NOTE_LIMIT = { width: 230, lines: 4, fontSize: 12, lineHeight: 15, fontWeight: 650 };
const CLEAN_ANNOTATION_LIMIT = { width: 210, lines: 3, fontSize: 11, lineHeight: 14, fontWeight: 650 };
const SKETCH_NOTE_LIMIT = { width: 170, lines: 5, fontSize: 19, lineHeight: 20, fontWeight: 650 };
const SKETCH_ANNOTATION_LIMIT = { width: 190, lines: 4, fontSize: 18, lineHeight: 19, fontWeight: 650 };
const CLEAN_MARKER_LIMIT = { width: 170, lines: 1, fontSize: 12, lineHeight: 15, fontWeight: 700 };
const SKETCH_MARKER_LIMIT = { width: 145, lines: 2, fontSize: 15, lineHeight: 17, fontWeight: 700 };
const CLEAN_EDGE_LIMIT = { width: 128, lines: 1, fontSize: 11, lineHeight: 14, fontWeight: 600 };
const SKETCH_EDGE_LIMIT = { width: 126, lines: 1, fontSize: 14, lineHeight: 17, fontWeight: 650 };
const CLEAN_EVOLUTION_TARGET_LIMIT = { width: 140, lines: 1, fontSize: 12, lineHeight: 15, fontWeight: 600 };
const SKETCH_EVOLUTION_TARGET_LIMIT = { width: 140, lines: 1, fontSize: 10, lineHeight: 13, fontWeight: 600 };

export function layoutWardleyTitleText(title: string, notation: WardleyTextNotation): WardleyVisibleText {
  const limit = notation === "sketch" ? SKETCH_TITLE_LIMIT : CLEAN_TITLE_LIMIT;
  return visibleText(title, limit);
}

export function layoutComponentLabelText(component: WardleyComponent, notation: WardleyTextNotation): WardleyVisibleText {
  const methodDecorators = component.method ? [component.method, ...component.decorators] : component.decorators;
  const decorator = methodDecorators.length > 0 ? ` (${methodDecorators.join(", ")})` : "";
  const submapText = component.kind === "submap" && component.submapUrlId ? ` [${component.submapUrlId}]` : "";
  const rawText = `${component.name}${decorator}${submapText}`;
  const limit = notation === "sketch"
    ? component.kind === "anchor"
      ? SKETCH_ANCHOR_LIMIT
      : rawText.length <= 56 ? SKETCH_COMPONENT_MEDIUM_LIMIT : SKETCH_COMPONENT_LIMIT
    : CLEAN_COMPONENT_LIMIT;
  return visibleText(rawText, limit);
}

export function layoutMarkerLabelText(marker: WardleyMarker, notation: WardleyTextNotation): WardleyVisibleText {
  const limit = notation === "sketch" ? SKETCH_MARKER_LIMIT : CLEAN_MARKER_LIMIT;
  return visibleText(marker.name, limit);
}

export function layoutCalloutText(kind: WardleyCalloutKind, text: string, notation: WardleyTextNotation): WardleyVisibleText {
  const rawText = notation === "sketch" ? text : `${kind}: ${text}`;
  const limit = notation === "sketch"
    ? kind === "annotation" ? SKETCH_ANNOTATION_LIMIT : SKETCH_NOTE_LIMIT
    : kind === "annotation" ? CLEAN_ANNOTATION_LIMIT : CLEAN_NOTE_LIMIT;
  return visibleText(rawText, limit);
}

export function layoutEdgeLabelText(text: string, notation: WardleyTextNotation): WardleyVisibleText {
  const limit = notation === "sketch" ? SKETCH_EDGE_LIMIT : CLEAN_EDGE_LIMIT;
  return visibleText(text, limit);
}

export function layoutEvolutionTargetText(text: string, notation: WardleyTextNotation): WardleyVisibleText {
  const limit = notation === "sketch" ? SKETCH_EVOLUTION_TARGET_LIMIT : CLEAN_EVOLUTION_TARGET_LIMIT;
  return visibleText(text, limit);
}

function visibleText(
  rawText: string,
  limit: { readonly width: number; readonly lines: number; readonly fontSize: number; readonly lineHeight: number; readonly fontWeight: number }
): WardleyVisibleText {
  const block = layoutTextBlock(rawText, {
    fontSize: limit.fontSize,
    fontWeight: limit.fontWeight,
    lineHeight: limit.lineHeight,
    maxWidth: limit.width,
    maxLines: limit.lines
  });
  return {
    ...block,
    rawText,
    fontSize: limit.fontSize,
    lineHeight: limit.lineHeight
  };
}
