import {
  analyzeWardleyLayout,
  buildWardleyGraph,
  highlightWardleyMapHtml,
  parseWardleyMap,
  renderWardleyMapSvg,
  summarizeWardleyMap,
  wardleyGraphNeighborhood,
  wardleyGraphPaths,
  validateWardleyMap,
  type WardleyGraph,
  type WardleyGraphEdge,
  type WardleyGraphPathResult,
  type WardleyMap
} from "../src/index.js";

type Notation = "sketch" | "clean";
type PreviewZoomMode = "auto" | "fit" | "custom";
interface PreviewDiagnostic {
  readonly message: string;
  readonly line?: number | undefined;
}

const DEFAULT_SOURCE = `title Wardley Map
component User [0.9, 0.2]
component Need [0.7, 0.45]
User->Need`;
const MAX_VISIBLE_DIAGNOSTICS = 12;
const LONG_SOURCE_LINE_LIMIT = 120;
const LONG_SOURCE_CHARACTER_LIMIT = 6000;
const LONG_MAP_TEXT_LIMIT = 52;
const LONG_CALLOUT_TEXT_LIMIT = 96;
const MAX_FOCUS_PATHS = 6;
const MAX_FOCUS_PATH_DEPTH = 12;

const sourceInput = requiredElement<HTMLTextAreaElement>("source-input");
const lineNumberLayer = requiredElement<HTMLElement>("line-number-layer");
const highlightLayer = requiredElement<HTMLElement>("highlight-layer");
const previewOutput = requiredElement<HTMLElement>("preview-output");
const previewPane = requiredElement<HTMLElement>("preview-pane");
const focusPaths = requiredElement<HTMLElement>("focus-paths");
const diagnostics = requiredElement<HTMLElement>("diagnostics");
const mapStatus = requiredElement<HTMLElement>("map-status");
const layoutStatus = requiredElement<HTMLElement>("layout-status");
const sourceMeta = requiredElement<HTMLElement>("source-meta");
const zoomStatus = requiredElement<HTMLElement>("zoom-status");
const sketchButton = requiredElement<HTMLButtonElement>("notation-sketch");
const cleanButton = requiredElement<HTMLButtonElement>("notation-clean");
const openButton = requiredElement<HTMLButtonElement>("open-source");
const openInput = requiredElement<HTMLInputElement>("open-source-input");
const saveButton = requiredElement<HTMLButtonElement>("save-source");
const resetButton = requiredElement<HTMLButtonElement>("reset-source");
const linkButton = requiredElement<HTMLButtonElement>("copy-link");
const svgButton = requiredElement<HTMLButtonElement>("download-svg");
const zoomOutButton = requiredElement<HTMLButtonElement>("zoom-out");
const zoomFitButton = requiredElement<HTMLButtonElement>("zoom-fit");
const zoomInButton = requiredElement<HTMLButtonElement>("zoom-in");
const fullscreenButton = requiredElement<HTMLButtonElement>("fullscreen-preview");

let notation: Notation = "sketch";
let lastMap: WardleyMap | undefined;
let lastSvg = "";
let previewZoom = 1;
let previewZoomMode: PreviewZoomMode = "auto";

initializeSource();

sourceInput.addEventListener("input", () => {
  syncHighlight();
  renderCurrent();
});

sourceInput.addEventListener("scroll", () => {
  syncEditorScroll();
});

document.addEventListener("keydown", (event) => {
  if (!isPrimaryShortcut(event)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (!event.shiftKey && key === "s") {
    event.preventDefault();
    saveCurrentSource();
    return;
  }
  if (!event.shiftKey && key === "enter") {
    event.preventDefault();
    downloadCurrentSvg();
  }
});

diagnostics.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const action = target.closest<HTMLElement>("[data-source-line]");
  if (!action) {
    return;
  }
  event.preventDefault();
  const line = Number(action.dataset.sourceLine);
  if (Number.isInteger(line) && line > 0) {
    jumpToSourceLine(line);
  }
});

sketchButton.addEventListener("click", () => setNotation("sketch"));
cleanButton.addEventListener("click", () => setNotation("clean"));
openButton.addEventListener("click", () => openInput.click());
openInput.addEventListener("change", async () => {
  const file = openInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    setSource(await file.text(), true);
  } catch (error) {
    diagnostics.dataset.state = "error";
    diagnostics.innerHTML = diagnosticList([{ message: error instanceof Error ? error.message : String(error) }]);
  } finally {
    openInput.value = "";
  }
});
saveButton.addEventListener("click", () => saveCurrentSource());
resetButton.addEventListener("click", () => {
  setSource(DEFAULT_SOURCE, true);
});
linkButton.addEventListener("click", () => {
  void copyPreviewStateLink();
});
svgButton.addEventListener("click", () => downloadCurrentSvg());
zoomOutButton.addEventListener("click", () => setPreviewZoom(previewZoom - 0.2));
zoomFitButton.addEventListener("click", () => fitPreview());
zoomInButton.addEventListener("click", () => setPreviewZoom(previewZoom + 0.2));
fullscreenButton.addEventListener("click", () => togglePreviewFullscreen());

function saveCurrentSource(): void {
  const filename = `${lastMap ? slugify(lastMap.title) : "wardley-map"}.owm`;
  downloadBytes(filename, "text/plain;charset=utf-8", new TextEncoder().encode(sourceInput.value));
}

function downloadCurrentSvg(): void {
  if (!lastMap || !lastSvg) {
    return;
  }
  downloadBytes(`${slugify(lastMap.title)}.svg`, "image/svg+xml;charset=utf-8", new TextEncoder().encode(lastSvg));
}

function initializeSource(): void {
  const state = previewStateFromHash();
  if (state) {
    notation = state.notation;
    setSource(state.source);
    syncNotationButtons();
    return;
  }
  setSource(DEFAULT_SOURCE);
}

function setSource(source: string, focus = false): void {
  sourceInput.value = source.trimEnd();
  syncHighlight();
  renderCurrent();
  if (focus) {
    sourceInput.focus();
  }
}

function setNotation(next: Notation): void {
  notation = next;
  syncNotationButtons();
  renderCurrent();
}

function syncNotationButtons(): void {
  sketchButton.dataset.active = String(notation === "sketch");
  cleanButton.dataset.active = String(notation === "clean");
}

function renderCurrent(): void {
  const source = sourceInput.value;
  const validation = validateWardleyMap(source, { filename: "preview.owm", includeSource: true });
  if (!validation.valid || !validation.map) {
    lastMap = undefined;
    lastSvg = "";
    previewOutput.innerHTML = `<div class="empty-preview">Invalid source</div>`;
    delete previewOutput.dataset.renderScale;
    hideFocusPaths(focusPaths);
    sourceMeta.textContent = sourceMetaLabel(source);
    mapStatus.textContent = "Parse error";
    layoutStatus.textContent = "";
    diagnostics.dataset.state = "error";
    diagnostics.innerHTML = diagnosticList(validation.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      line: diagnostic.line
    })));
    return;
  }

  const map = parseWardleyMap(source, { filename: "preview.owm", includeSource: true });
  const summary = summarizeWardleyMap(map);
  const layout = analyzeWardleyLayout(map, { notation, autoScale: true });
  const svg = renderWardleyMapSvg(map, { notation, autoScale: true });
  const complexity = complexityDiagnostics(summary, map, source);
  const layoutMessages = layout.diagnostics.map((diagnostic) => `${diagnostic.sourceLabel}: ${diagnostic.message}`);
  const diagnosticsMessages = [...complexity.map((message) => ({ message })), ...layoutMessages.map((message) => ({ message }))];

  lastMap = map;
  const graph = buildWardleyGraph(map);
  lastSvg = svg;
  previewOutput.innerHTML = `<div class="preview-stage">${svg}</div>`;
  previewOutput.dataset.renderScale = renderScaleFor(map, layout.width, layout.height).toFixed(2);
  applyPreviewZoom();
  applyAnnotationDisplayMode(previewOutput, summary, map);
  installWardleyFocus(previewOutput, graph, focusPaths);
  sourceMeta.textContent = sourceMetaLabel(source);
  mapStatus.textContent = `${summary.componentCount} components, ${summary.linkCount} links, ${summary.attitudeCount} PST`;
  layoutStatus.textContent = layout.diagnostics.length === 0
    ? complexity.length === 0 ? "No overlaps detected" : "Dense map"
    : `${layout.diagnostics.length} warnings`;
  diagnostics.dataset.state = diagnosticsMessages.length === 0 ? "ok" : "warn";
  diagnostics.innerHTML = diagnosticsMessages.length === 0
    ? "Layout check passed for labels, nodes, and map links."
    : diagnosticList(diagnosticsMessages);
}

function setPreviewZoom(next: number): void {
  previewZoomMode = "custom";
  previewZoom = Math.max(0.6, Math.min(2.4, Math.round(next * 10) / 10));
  applyPreviewZoom();
}

function fitPreview(): void {
  previewZoomMode = "fit";
  previewZoom = 1;
  applyPreviewZoom();
}

function renderScaleFor(map: WardleyMap, width: number, height: number): number {
  const baseWidth = map.size.width || width;
  const baseHeight = map.size.height || height;
  return Math.max(width / baseWidth, height / baseHeight);
}

function applyPreviewZoom(): void {
  const svg = previewOutput.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    return;
  }
  const baseWidth = Number(svg.getAttribute("width") ?? lastMap?.size.width ?? 960);
  const renderScale = Number(previewOutput.dataset.renderScale ?? "1");
  if (previewZoomMode === "fit" || (previewZoomMode === "auto" && renderScale <= 1.01)) {
    svg.style.removeProperty("width");
    svg.style.removeProperty("max-width");
    previewOutput.dataset.zoom = "fit";
    zoomStatus.textContent = "Fit";
  } else if (previewZoomMode === "auto") {
    svg.style.maxWidth = "none";
    svg.style.width = `${baseWidth}px`;
    previewOutput.dataset.zoom = "auto";
    zoomStatus.textContent = `Auto ${Math.round(renderScale * 100)}%`;
  } else {
    svg.style.maxWidth = "none";
    svg.style.width = `${Math.round(baseWidth * previewZoom)}px`;
    previewOutput.dataset.zoom = "custom";
    zoomStatus.textContent = `${Math.round(previewZoom * 100)}%`;
  }
  zoomFitButton.dataset.active = String(previewZoomMode === "fit");
}

function togglePreviewFullscreen(): void {
  const next = previewPane.dataset.fullscreen !== "true";
  previewPane.dataset.fullscreen = String(next);
  fullscreenButton.dataset.active = String(next);
  fullscreenButton.textContent = next ? "Exit" : "Full";
}

function applyAnnotationDisplayMode(container: HTMLElement, summary: ReturnType<typeof summarizeWardleyMap>, map: WardleyMap): void {
  const svg = container.querySelector("svg");
  if (!svg) {
    return;
  }
  if (shouldUseHoverAnnotations(summary, map)) {
    svg.setAttribute("data-wardley-annotation-mode", "hover");
  } else {
    svg.removeAttribute("data-wardley-annotation-mode");
  }
}

function installWardleyFocus(container: HTMLElement, graph: WardleyGraph, focusPanel: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) {
    return;
  }
  const itemSelector = "[data-wardley-component-id], [data-wardley-link-id], [data-wardley-marker-id], [data-wardley-callout-id]";
  const items = () => Array.from(svg.querySelectorAll<Element>(
    itemSelector
  ));
  let clearTimer: ReturnType<typeof window.setTimeout> | undefined;

  function cancelClear(): void {
    if (clearTimer !== undefined) {
      window.clearTimeout(clearTimer);
      clearTimer = undefined;
    }
  }

  function scheduleClear(): void {
    cancelClear();
    clearTimer = window.setTimeout(() => {
      clearTimer = undefined;
      clearWardleyFocus(svg, items(), focusPanel);
    }, 120);
  }

  focusPanel.onmouseenter = () => cancelClear();
  focusPanel.onmouseleave = () => scheduleClear();

  svg.addEventListener("mouseover", (event) => {
    const target = event.target as Element | null;
    const item = target?.closest(itemSelector);
    if (!item) {
      clearWardleyFocus(svg, items(), focusPanel);
      return;
    }
    cancelClear();
    const visible = relatedFocusKeys(graph, item);
    svg.setAttribute("data-wardley-focus-active", "true");
    for (const candidate of items()) {
      const key = focusKey(candidate);
      candidate.classList.toggle("wardley-focus-visible", key !== undefined && visible.has(key));
    }
    updateFocusPaths(focusPanel, graph, item, visible);
  });

  svg.addEventListener("mouseleave", () => {
    scheduleClear();
  });
}

function clearWardleyFocus(svg: Element, items: readonly Element[], focusPanel?: HTMLElement): void {
  svg.removeAttribute("data-wardley-focus-active");
  for (const item of items) {
    item.classList.remove("wardley-focus-visible");
  }
  if (focusPanel) {
    hideFocusPaths(focusPanel);
  }
}

function relatedFocusKeys(graph: WardleyGraph, item: Element): Set<string> {
  const key = focusKey(item);
  const visible = new Set<string>();
  if (key) {
    visible.add(key);
  }
  const componentId = item.getAttribute("data-wardley-component-id");
  const linkId = item.getAttribute("data-wardley-link-id");
  if (componentId) {
    const neighborhood = wardleyGraphNeighborhood(graph, { componentId }, { traversal: "reachable", direction: "both" });
    for (const relatedComponentId of neighborhood.componentIds) {
      visible.add(`component:${relatedComponentId}`);
    }
    for (const edgeId of neighborhood.edgeIds) {
      visible.add(`link:${edgeId}`);
    }
  }
  if (linkId) {
    const neighborhood = wardleyGraphNeighborhood(graph, { edgeId: linkId });
    for (const relatedComponentId of neighborhood.componentIds) {
      visible.add(`component:${relatedComponentId}`);
    }
    for (const edgeId of neighborhood.edgeIds) {
      visible.add(`link:${edgeId}`);
    }
  }
  return visible;
}

function updateFocusPaths(panel: HTMLElement, graph: WardleyGraph, item: Element, visible: ReadonlySet<string>): void {
  const componentId = item.getAttribute("data-wardley-component-id");
  const linkId = item.getAttribute("data-wardley-link-id");
  if (componentId) {
    const node = graph.nodesById.get(componentId);
    if (!node) {
      hideFocusPaths(panel);
      return;
    }
    const upstream = wardleyGraphPaths(graph, componentId, "incoming", { maxPaths: MAX_FOCUS_PATHS, maxDepth: MAX_FOCUS_PATH_DEPTH });
    const downstream = wardleyGraphPaths(graph, componentId, "outgoing", { maxPaths: MAX_FOCUS_PATHS, maxDepth: MAX_FOCUS_PATH_DEPTH });
    panel.innerHTML = focusComponentPathsHtml(node.name, visible, upstream, downstream);
    panel.hidden = false;
    return;
  }
  if (linkId) {
    const edge = graph.edgesById.get(linkId);
    if (!edge) {
      hideFocusPaths(panel);
      return;
    }
    panel.innerHTML = focusLinkPathHtml(edge, visible);
    panel.hidden = false;
    return;
  }
  hideFocusPaths(panel);
}

function hideFocusPaths(panel: HTMLElement): void {
  panel.hidden = true;
  panel.innerHTML = "";
}

function focusComponentPathsHtml(
  name: string,
  visible: ReadonlySet<string>,
  upstream: WardleyGraphPathResult,
  downstream: WardleyGraphPathResult
): string {
  const componentCount = countFocusKeys(visible, "component:");
  const linkCount = countFocusKeys(visible, "link:");
  return [
    `<div class="focus-paths-kicker">Path focus</div>`,
    `<div class="focus-paths-title">${escapeHtml(name)}</div>`,
    `<div class="focus-paths-meta">${componentCount} components, ${linkCount} links in full reachable context</div>`,
    focusPathGroupHtml("Upstream", upstream),
    focusPathGroupHtml("Downstream", downstream)
  ].join("");
}

function focusLinkPathHtml(edge: WardleyGraphEdge, visible: ReadonlySet<string>): string {
  const componentCount = countFocusKeys(visible, "component:");
  const linkCount = countFocusKeys(visible, "link:");
  return [
    `<div class="focus-paths-kicker">Direct link</div>`,
    `<div class="focus-paths-title">${escapeHtml(edge.sourceName)} -> ${escapeHtml(edge.targetName)}</div>`,
    `<div class="focus-paths-meta">${componentCount} components, ${linkCount} link focused</div>`,
    `<div class="focus-path">${pathNodeHtml(edge.sourceName)}<span class="focus-path-arrow">-></span>${pathNodeHtml(edge.targetName)}</div>`
  ].join("");
}

function focusPathGroupHtml(title: string, result: WardleyGraphPathResult): string {
  if (result.paths.length === 0) {
    return `<div class="focus-path-group"><strong>${escapeHtml(title)}</strong><p>No connected path.</p></div>`;
  }
  const items = result.paths
    .map((path) => `<div class="focus-path">${path.componentNames.map(pathNodeHtml).join(`<span class="focus-path-arrow">-></span>`)}</div>`)
    .join("");
  const more = result.truncated ? `<p class="focus-paths-more">More paths hidden for readability.</p>` : "";
  return `<div class="focus-path-group"><strong>${escapeHtml(title)}</strong>${items}${more}</div>`;
}

function pathNodeHtml(componentName: string): string {
  return `<span class="focus-path-node">${escapeHtml(componentName)}</span>`;
}

function countFocusKeys(visible: ReadonlySet<string>, prefix: string): number {
  let count = 0;
  for (const key of visible) {
    if (key.startsWith(prefix)) {
      count += 1;
    }
  }
  return count;
}

function focusKey(item: Element): string | undefined {
  const componentId = item.getAttribute("data-wardley-component-id");
  if (componentId) {
    return `component:${componentId}`;
  }
  const linkId = item.getAttribute("data-wardley-link-id");
  if (linkId) {
    return `link:${linkId}`;
  }
  const markerId = item.getAttribute("data-wardley-marker-id");
  if (markerId) {
    return `marker:${markerId}`;
  }
  const calloutId = item.getAttribute("data-wardley-callout-id");
  if (calloutId) {
    return `callout:${calloutId}`;
  }
  return undefined;
}

function syncHighlight(): void {
  highlightLayer.innerHTML = highlightWardleyMapHtml(sourceInput.value, { lineNumbers: false });
  lineNumberLayer.textContent = lineNumbersFor(sourceInput.value);
  syncEditorScroll();
}

function syncEditorScroll(): void {
  highlightLayer.scrollTop = sourceInput.scrollTop;
  highlightLayer.scrollLeft = sourceInput.scrollLeft;
  lineNumberLayer.style.transform = `translateY(${-sourceInput.scrollTop}px)`;
}

function isPrimaryShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

function diagnosticList(items: readonly PreviewDiagnostic[]): string {
  if (items.length === 0) {
    return "";
  }
  const visible = items.slice(0, MAX_VISIBLE_DIAGNOSTICS);
  const hidden = items.length - visible.length;
  return `<strong>${items.length === 1 ? "Issue" : "Issues"} (${items.length})</strong><ul>${visible
    .map((item) => `<li>${diagnosticItemHtml(item)}</li>`)
    .join("")}</ul>${hidden > 0
    ? `<p class="diagnostics-more">${hidden} more not shown. Move labels, split the map, or switch notation before exporting.</p>`
    : ""}`;
}

function diagnosticItemHtml(item: PreviewDiagnostic): string {
  const prefix = item.line
    ? `<button type="button" class="diagnostic-jump" data-source-line="${item.line}">Line ${item.line}</button>`
    : "";
  return `${prefix}${escapeHtml(item.message)}`;
}

function jumpToSourceLine(line: number): void {
  const lines = sourceInput.value.split(/\r?\n/u);
  const targetLine = Math.min(line, Math.max(lines.length, 1));
  const start = lines.slice(0, targetLine - 1).reduce((offset, value) => offset + value.length + 1, 0);
  const end = start + (lines[targetLine - 1]?.length ?? 0);
  const lineHeight = Number.parseFloat(window.getComputedStyle(sourceInput).lineHeight) || 20;
  sourceInput.focus();
  sourceInput.scrollTop = Math.max(0, (targetLine - 2) * lineHeight);
  syncEditorScroll();
  sourceInput.setSelectionRange(start, end, "forward");
}

function shouldUseHoverAnnotations(summary: ReturnType<typeof summarizeWardleyMap>, map: WardleyMap): boolean {
  if (summary.annotationCount === 0) {
    return false;
  }
  const visualItems = summary.componentCount + summary.linkCount + summary.evolutionCount + summary.annotationCount
    + summary.noteCount + summary.markerCount + summary.pipelineCount + summary.attitudeCount;
  const calloutCount = summary.annotationCount + summary.noteCount;
  return summary.componentCount >= 28 || summary.linkCount >= 40 || visualItems >= 80 || calloutCount >= 4;
}

function complexityDiagnostics(summary: ReturnType<typeof summarizeWardleyMap>, map: WardleyMap, source: string): readonly string[] {
  const stats = sourceStats(source);
  const visualItems = summary.componentCount + summary.linkCount + summary.evolutionCount + summary.annotationCount
    + summary.noteCount + summary.markerCount + summary.pipelineCount + summary.attitudeCount;
  const longLabels = map.components.filter((component) => displayTextLength(component.name) >= LONG_MAP_TEXT_LIMIT);
  const longCallouts = [
    ...map.annotations.map((annotation) => annotation.text),
    ...map.notes.map((note) => note.text)
  ].filter((text) => displayTextLength(text) >= LONG_CALLOUT_TEXT_LIMIT);
  const messages: string[] = [];
  if (stats.lines >= LONG_SOURCE_LINE_LIMIT || stats.characters >= LONG_SOURCE_CHARACTER_LIMIT) {
    messages.push(`Long source: ${stats.lines} lines and ${compactCount(stats.characters)} chars. Split narrative context into focused maps before export.`);
  }
  if (summary.componentCount >= 28 || summary.linkCount >= 40 || visualItems >= 80) {
    messages.push(`Dense map: ${summary.componentCount} components, ${summary.linkCount} links, and ${visualItems} visual items. Split the story or hide secondary annotations before export.`);
  }
  if (visualItems >= 70 && map.size.width <= 960 && map.size.height <= 640) {
    messages.push(`Map size ${map.size.width}x${map.size.height} is tight for this source. Use a larger size or separate the map into focused views.`);
  }
  if (longLabels.length >= 3) {
    messages.push(`Long component labels: ${longLabels.length} labels are ${LONG_MAP_TEXT_LIMIT}+ chars. Shorten map labels and move detail into notes or annotations.`);
  }
  if (longCallouts.length > 0) {
    const plural = longCallouts.length === 1 ? "" : "s";
    const verb = longCallouts.length === 1 ? "is" : "are";
    messages.push(`Long callouts: ${longCallouts.length} callout${plural} ${verb} ${LONG_CALLOUT_TEXT_LIMIT}+ chars. Keep callouts short to avoid overlap.`);
  }
  return messages;
}

function downloadBytes(filename: string, type: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyPreviewStateLink(): Promise<void> {
  const previousLabel = linkButton.textContent ?? "Link";
  try {
    const link = updateCurrentPreviewStateUrl();
    linkButton.textContent = "Copied";
    linkButton.dataset.copied = "true";
    window.setTimeout(() => {
      linkButton.textContent = previousLabel;
      delete linkButton.dataset.copied;
    }, 1400);
    await writeClipboardText(link);
  } catch (error) {
    linkButton.textContent = previousLabel;
    delete linkButton.dataset.copied;
    diagnostics.dataset.state = "error";
    diagnostics.innerHTML = diagnosticList([{
      message: `Could not copy preview link: ${error instanceof Error ? error.message : String(error)}`
    }]);
  }
}

function updateCurrentPreviewStateUrl(): string {
  const url = new URL(window.location.href);
  url.hash = previewStateHash();
  window.history.replaceState(null, "", url);
  return url.toString();
}

function previewStateHash(): string {
  const params = new URLSearchParams();
  params.set("notation", notation);
  params.set("source", encodeBase64Url(sourceInput.value));
  return params.toString();
}

function previewStateFromHash(): { readonly source: string; readonly notation: Notation } | undefined {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) {
    return undefined;
  }
  const params = new URLSearchParams(hash);
  const encodedSource = params.get("source");
  if (!encodedSource) {
    return undefined;
  }
  const source = decodeBase64Url(encodedSource);
  if (source === undefined) {
    return undefined;
  }
  return {
    source,
    notation: notationFromString(params.get("notation")) ?? "sketch"
  };
}

function notationFromString(value: string | null): Notation | undefined {
  return value === "clean" || value === "sketch" ? value : undefined;
}

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (copyTextWithHiddenField(value)) {
    return;
  }
  throw new Error("Clipboard API is unavailable.");
}

function copyTextWithHiddenField(value: string): boolean {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.style.top = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand?.("copy") ?? false;
  field.remove();
  return copied;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string | undefined {
  try {
    const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "wardley-map";
}

function lineCount(value: string): number {
  return value.length === 0 ? 1 : value.split(/\r?\n/u).length;
}

function sourceStats(value: string): { readonly lines: number; readonly characters: number } {
  return {
    lines: lineCount(value),
    characters: [...value].length
  };
}

function sourceMetaLabel(value: string): string {
  const stats = sourceStats(value);
  return `${stats.lines} lines, ${compactCount(stats.characters)} chars`;
}

function compactCount(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
}

function displayTextLength(value: string): number {
  return [...value].length;
}

function lineNumbersFor(value: string): string {
  return Array.from({ length: lineCount(value) }, (_, index) => String(index + 1)).join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}
