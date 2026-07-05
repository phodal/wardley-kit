#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import {
  analyzeWardleyLayout,
  parseWardleyMap,
  renderWardleyMapSvg,
  summarizeWardleyMap
} from "../dist-lib/index.js";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const previewDir = join(repoRoot, "dist");
const fixturePath = join(repoRoot, "test", "fixtures", "wardley-preview-signatures.json");
const notationModes = ["sketch", "clean"];
const updateSnapshots = process.argv.includes("--update");
let previewImportCounter = 0;

await main();

async function main() {
  const files = listWardleyFiles(join(repoRoot, "examples"));
  if (files.length === 0) {
    throw new Error("No Wardley preview examples found.");
  }

  const signatures = Object.fromEntries(
    files.flatMap((file) => notationModes.map((notation) => {
      const signature = createVisualSignature(file, notation);
      return [signature.key, signature];
    }))
  );

  if (updateSnapshots) {
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify({
      version: 1,
      description: "Stable Wardley preview SVG signatures. Update intentionally with node scripts/verify-preview.mjs --update.",
      signatures
    }, null, 2)}\n`, "utf8");
    console.log(`Updated Wardley preview signatures: ${relative(repoRoot, fixturePath)}`);
  } else {
    assertSignaturesMatch(signatures);
  }

  const previewResults = await verifyPreviewUi(files);
  console.table(previewResults);
  console.log(`Wardley preview verification OK: ${files.length} maps, ${notationModes.length} notations.`);
}

function createVisualSignature(file, notation) {
  const source = readFileSync(file, "utf8");
  const map = parseWardleyMap(source, { filename: relative(repoRoot, file) });
  const svg = renderWardleyMapSvg(map, { notation });
  const layout = analyzeWardleyLayout(map, { notation });
  const dense = isDenseMap(map);

  if (!svg.trimStart().startsWith("<svg")) {
    throw new Error(`${relative(repoRoot, file)} ${notation}: SVG render did not produce an <svg> document.`);
  }
  if (!svg.includes(map.title)) {
    throw new Error(`${relative(repoRoot, file)} ${notation}: SVG render is missing the map title "${map.title}".`);
  }
  const blockingDiagnostics = layout.diagnostics.filter((diagnostic) => diagnostic.code !== "S4WARDLEY_LAYOUT_TEXT_TRUNCATED");
  if (blockingDiagnostics.length > 0 && !dense) {
    throw new Error(`${relative(repoRoot, file)} ${notation}: layout diagnostics: ${blockingDiagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
  }

  return {
    key: `${relative(repoRoot, file)}#${notation}`,
    file: relative(repoRoot, file),
    notation,
    title: map.title,
    size: map.size,
    components: map.components.length,
    links: map.links.length,
    annotations: map.annotations.length,
    notes: map.notes.length,
    attitudes: map.attitudes.length,
    markers: map.markers.length,
    dense,
    layoutWarnings: layout.diagnostics.length,
    svgBytes: Buffer.byteLength(svg),
    svgHash: sha256(svg),
    elementCounts: {
      paths: countMatches(svg, /<path\b/gu),
      lines: countMatches(svg, /<line\b/gu),
      circles: countMatches(svg, /<circle\b/gu),
      rectangles: countMatches(svg, /<rect\b/gu),
      texts: countMatches(svg, /<text\b/gu),
      tspans: countMatches(svg, /<tspan\b/gu)
    }
  };
}

function assertSignaturesMatch(actual) {
  if (!existsSync(fixturePath)) {
    throw new Error(`Missing Wardley preview signatures. Run node scripts/verify-wardley-preview.mjs --update first.`);
  }

  const expected = JSON.parse(readFileSync(fixturePath, "utf8")).signatures;
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.join("\n") !== actualKeys.join("\n")) {
    throw new Error(`Wardley preview signature keys changed.\nExpected:\n${expectedKeys.join("\n")}\nActual:\n${actualKeys.join("\n")}`);
  }

  const mismatches = [];
  for (const key of expectedKeys) {
    const expectedSignature = expected[key];
    const actualSignature = actual[key];
    if (JSON.stringify(expectedSignature) !== JSON.stringify(actualSignature)) {
      mismatches.push(key);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Wardley preview signatures changed for ${mismatches.length} case(s): ${mismatches.join(", ")}. If this is intended, run node scripts/verify-wardley-preview.mjs --update.`);
  }
}

async function verifyPreviewUi(files) {
  const window = await createPreviewWindow();
  const { document } = window;
  const exampleSelect = requiredElement(document, "example-select");
  const sourceInput = requiredElement(document, "source-input");
  const lineNumberLayer = requiredElement(document, "line-number-layer");
  const sketchButton = requiredElement(document, "notation-sketch");
  const cleanButton = requiredElement(document, "notation-clean");
  requiredElement(document, "open-source");
  const saveButton = requiredElement(document, "save-source");
  const linkButton = requiredElement(document, "copy-link");
  const svgButton = requiredElement(document, "download-svg");
  const previewPane = requiredElement(document, "preview-pane");
  const previewOutput = requiredElement(document, "preview-output");
  const mapStatus = requiredElement(document, "map-status");
  const layoutStatus = requiredElement(document, "layout-status");
  const zoomStatus = requiredElement(document, "zoom-status");
  const zoomOutButton = requiredElement(document, "zoom-out");
  const zoomFitButton = requiredElement(document, "zoom-fit");
  const zoomInButton = requiredElement(document, "zoom-in");
  const fullscreenButton = requiredElement(document, "fullscreen-preview");
  const focusPaths = requiredElement(document, "focus-paths");
  const sourceMeta = requiredElement(document, "source-meta");
  const diagnostics = requiredElement(document, "diagnostics");

  await verifyExampleSelector(window, files, exampleSelect, previewOutput);
  await verifySourceDownload(window, saveButton);
  await verifyKeyboardShortcuts(window, sourceInput);
  await verifyEditorLineNumbers(window, sourceInput, lineNumberLayer);
  await verifyDiagnosticJump(window, sourceInput, diagnostics);
  await verifyLongSourceDiagnostics(window, sourceInput, sourceMeta, layoutStatus, diagnostics);
  await verifyLongTextDiagnostics(window, sourceInput, diagnostics);
  await verifyDenseDiagnostics(window, sourceInput, diagnostics);
  await verifyComplexityDiagnostics(window, sourceInput, diagnostics);
  await verifyHoverFocus(window, sourceInput, previewOutput, focusPaths);
  await verifyDenseAnnotationHoverMode(window, sourceInput, previewOutput);
  await verifyPreviewControls(window, sourceInput, previewPane, previewOutput, zoomStatus, zoomOutButton, zoomFitButton, zoomInButton, fullscreenButton);

  const results = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8").trimEnd();
    const map = parseWardleyMap(source, { filename: relative(repoRoot, file) });
    const summary = summarizeWardleyMap(map);
    sourceInput.value = source;
    sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await window.happyDOM.whenAsyncComplete();

    for (const notation of notationModes) {
      (notation === "sketch" ? sketchButton : cleanButton).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.whenAsyncComplete();

      const layout = analyzeWardleyLayout(map, { notation, autoScale: true });
      const dense = isDenseMap(map);
      const expectedStatus = `${summary.componentCount} components, ${summary.linkCount} links, ${summary.attitudeCount} PST`;
      if (mapStatus.textContent !== expectedStatus) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: expected map status "${expectedStatus}", got "${mapStatus.textContent}".`);
      }
      if (sourceMeta.textContent !== sourceMetaLabel(source)) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: source meta did not update.`);
      }
      const blockingDiagnostics = layout.diagnostics.filter((diagnostic) => diagnostic.code !== "S4WARDLEY_LAYOUT_TEXT_TRUNCATED");
      if (blockingDiagnostics.length > 0 && !dense) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: layout diagnostics: ${blockingDiagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
      }
      const expectedLayoutStatus = layout.diagnostics.length === 0 ? "No overlaps detected" : `${layout.diagnostics.length} warnings`;
      if (layoutStatus.textContent !== expectedLayoutStatus) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: expected layout status "${expectedLayoutStatus}", got "${layoutStatus.textContent}".`);
      }
      const svg = previewOutput.querySelector("svg");
      if (!svg) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: preview output did not contain an SVG element.`);
      }
      if (svg.getAttribute("aria-label") !== map.title) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: preview SVG title mismatch.`);
      }

      const svgDownload = await clickDownload(window, svgButton);
      const svgText = await svgDownload.blob.text();
      if (!svgText.trimStart().startsWith("<svg")) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: SVG download did not contain an SVG document.`);
      }
      if (!svgDownload.download.endsWith(".svg")) {
        throw new Error(`${relative(repoRoot, file)} ${notation}: SVG download filename was "${svgDownload.download}".`);
      }

      results.push({
        file: relative(repoRoot, file),
        notation,
        status: "OK",
        svgBytes: svgText.length
      });
    }
  }
  await verifyPreviewStateLink(window, sourceInput, linkButton, cleanButton);
  return results;
}

async function verifyExampleSelector(window, files, exampleSelect, previewOutput) {
  const optionValues = [...exampleSelect.querySelectorAll("option")].map((option) => option.value);
  const expectedValues = files.map((file) => basename(file, extname(file)));
  const missingOptions = [...expectedValues, "custom"].filter((value) => !optionValues.includes(value));
  if (missingOptions.length > 0) {
    throw new Error(`Example selector is missing option(s): ${missingOptions.join(", ")}`);
  }

  for (const file of files) {
    const id = basename(file, extname(file));
    const source = readFileSync(file, "utf8");
    const map = parseWardleyMap(source, { filename: relative(repoRoot, file) });
    exampleSelect.value = id;
    exampleSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    await window.happyDOM.whenAsyncComplete();
    const svg = previewOutput.querySelector("svg");
    if (svg?.getAttribute("aria-label") !== map.title) {
      throw new Error(`${relative(repoRoot, file)}: example selector did not load "${map.title}".`);
    }
  }
}

async function verifySourceDownload(window, saveButton) {
  const download = await clickDownload(window, saveButton);
  if (!download.download.endsWith(".owm")) {
    throw new Error(`Source download filename was "${download.download}".`);
  }
  const source = await download.blob.text();
  if (!source.trimStart().startsWith("title ")) {
    throw new Error("Source download did not contain Wardley map source.");
  }
}

async function verifyKeyboardShortcuts(window, sourceInput) {
  sourceInput.value = `title Shortcut Export
component User [0.9, 0.2]
component Need [0.8, 0.4]
User->Need`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const saveEvent = new window.KeyboardEvent("keydown", {
    key: "s",
    metaKey: true,
    bubbles: true,
    cancelable: true
  });
  const sourceDownload = await captureDownload(window, () => sourceInput.dispatchEvent(saveEvent), "keyboard save");
  const source = await sourceDownload.blob.text();
  if (!saveEvent.defaultPrevented) {
    throw new Error("Save shortcut did not prevent the browser default.");
  }
  if (!sourceDownload.download.endsWith(".owm") || !source.includes("title Shortcut Export")) {
    throw new Error(`Save shortcut downloaded unexpected source "${sourceDownload.download}".`);
  }

  const svgEvent = new window.KeyboardEvent("keydown", {
    key: "Enter",
    metaKey: true,
    bubbles: true,
    cancelable: true
  });
  const svgDownload = await captureDownload(window, () => sourceInput.dispatchEvent(svgEvent), "keyboard SVG");
  const svg = await svgDownload.blob.text();
  if (!svgEvent.defaultPrevented) {
    throw new Error("SVG shortcut did not prevent the browser default.");
  }
  if (!svgDownload.download.endsWith(".svg") || !svg.trimStart().startsWith("<svg")) {
    throw new Error(`SVG shortcut downloaded unexpected artifact "${svgDownload.download}".`);
  }
}

async function verifyPreviewStateLink(window, sourceInput, linkButton, cleanButton) {
  const linkedSource = `title Linked State
component 用户 [0.9, 0.2]
component Need [0.8, 0.4]
用户->Need`;
  sourceInput.value = linkedSource;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  cleanButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  linkButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  for (let index = 0; index < 20 && linkButton.textContent !== "Copied"; index += 1) {
    await window.happyDOM.whenAsyncComplete();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }

  const copiedLink = window.__wardleyClipboardWrites.at(-1);
  if (!copiedLink) {
    throw new Error("Preview state link was not written to the clipboard.");
  }
  const copiedUrl = new URL(copiedLink);
  if (!copiedUrl.hash.includes("notation=clean") || !copiedUrl.hash.includes("source=")) {
    throw new Error(`Preview state link hash is missing state fields: ${copiedUrl.hash}`);
  }
  if (window.location.hash !== copiedUrl.hash) {
    throw new Error(`Preview state link did not update the current hash, got "${window.location.hash}".`);
  }
  if (linkButton.textContent !== "Copied" || linkButton.dataset.copied !== "true") {
    throw new Error("Preview state link did not show copied feedback.");
  }

  const restoredWindow = await createPreviewWindow(copiedUrl.hash);
  const restoredDocument = restoredWindow.document;
  const restoredSource = requiredElement(restoredDocument, "source-input");
  const restoredClean = requiredElement(restoredDocument, "notation-clean");
  const restoredMapStatus = requiredElement(restoredDocument, "map-status");
  if (restoredSource.value !== linkedSource) {
    throw new Error("Preview state link did not restore the source text.");
  }
  if (restoredClean.dataset.active !== "true") {
    throw new Error("Preview state link did not restore clean notation.");
  }
  if (restoredMapStatus.textContent !== "2 components, 1 links, 0 PST") {
    throw new Error(`Preview state link restored unexpected map status: "${restoredMapStatus.textContent}".`);
  }
}

async function verifyEditorLineNumbers(window, sourceInput, lineNumberLayer) {
  sourceInput.value = `title Line Numbers
component User [0.9, 0.2]
component Need [0.8, 0.4]
User->Need`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const expected = "1\n2\n3\n4";
  if (lineNumberLayer.textContent !== expected) {
    throw new Error(`Editor line numbers did not update. Expected "${expected}", got "${lineNumberLayer.textContent}".`);
  }

  sourceInput.scrollTop = 31;
  sourceInput.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (lineNumberLayer.style.transform !== "translateY(-31px)") {
    throw new Error(`Editor line numbers did not sync scroll, got "${lineNumberLayer.style.transform}".`);
  }
}

async function verifyDiagnosticJump(window, sourceInput, diagnostics) {
  sourceInput.value = `title Jump Diagnostics
component User [0.9, 0.2]
User->Missing Need`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const jump = diagnostics.querySelector(".diagnostic-jump");
  if (!jump) {
    throw new Error("Parse diagnostics did not render a source-line jump.");
  }
  if (jump.textContent !== "Line 3") {
    throw new Error(`Parse diagnostic jump should target line 3, got "${jump.textContent}".`);
  }

  jump.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const expectedStart = "title Jump Diagnostics\ncomponent User [0.9, 0.2]\n".length;
  const expectedEnd = expectedStart + "User->Missing Need".length;
  if (sourceInput.selectionStart !== expectedStart || sourceInput.selectionEnd !== expectedEnd) {
    throw new Error(`Diagnostic jump selected ${sourceInput.selectionStart}:${sourceInput.selectionEnd}, expected ${expectedStart}:${expectedEnd}.`);
  }
}

async function verifyLongSourceDiagnostics(window, sourceInput, sourceMeta, layoutStatus, diagnostics) {
  const contextLines = Array.from({ length: 126 }, (_, index) => `// context line ${index + 1}`);
  sourceInput.value = [
    "title Long Source",
    "anchor User [0.9, 0.2]",
    "component Need [0.8, 0.5]",
    "User->Need",
    ...contextLines
  ].join("\n");
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  if (sourceMeta.textContent !== sourceMetaLabel(sourceInput.value)) {
    throw new Error(`Long source meta did not update, got "${sourceMeta.textContent}".`);
  }
  if (!diagnostics.textContent?.includes("Long source: 130 lines")) {
    throw new Error("Long source diagnostics did not report excessive source length.");
  }
  if (layoutStatus.textContent !== "Dense map") {
    throw new Error(`Long source diagnostics should mark the layout as dense, got "${layoutStatus.textContent}".`);
  }
}

async function verifyLongTextDiagnostics(window, sourceInput, diagnostics) {
  sourceInput.value = `title Long Text
anchor User group with a very long descriptive name [0.9, 0.2]
component A very long component label that needs to be shortened before export [0.8, 0.4]
component Another very long component label that carries narrative detail [0.7, 0.5]
component Third very long component label that will crowd nearby map text [0.6, 0.6]
User group with a very long descriptive name->A very long component label that needs to be shortened before export
annotation 1 [0.7, 0.5] This annotation is intentionally very long because it simulates pasted narrative content that belongs in supporting notes rather than directly inside the visible Wardley map`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  if (!diagnostics.textContent?.includes("Long component labels: 3 labels")) {
    throw new Error("Long text diagnostics did not report oversized component labels.");
  }
  if (!diagnostics.textContent?.includes("Long callouts: 1 callout")) {
    throw new Error("Long text diagnostics did not report oversized callouts.");
  }
}

async function verifyDenseDiagnostics(window, sourceInput, diagnostics) {
  const denseSource = `title Dense Diagnostics
component A [0.5, 0.5] label [0, 0]
component B [0.5, 0.5] label [0, 0]
component C [0.5, 0.5] label [0, 0]
component D [0.5, 0.5] label [0, 0]
component E [0.5, 0.5] label [0, 0]
component F [0.5, 0.5] label [0, 0]
component G [0.5, 0.5] label [0, 0]
component H [0.5, 0.5] label [0, 0]
A->B
B->C
C->D
D->E
E->F
F->G
G->H
`;
  sourceInput.value = denseSource.trimEnd();
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const items = diagnostics.querySelectorAll("li");
  if (items.length !== 12) {
    throw new Error(`Dense diagnostics should render 12 visible items, got ${items.length}.`);
  }
  if (!diagnostics.textContent?.includes("more not shown")) {
    throw new Error("Dense diagnostics did not report hidden diagnostics.");
  }
}

async function verifyComplexityDiagnostics(window, sourceInput, diagnostics) {
  const components = Array.from({ length: 30 }, (_, index) => {
    const visibility = (0.92 - (index % 10) * 0.07).toFixed(2);
    const evolution = (0.12 + Math.floor(index / 10) * 0.22 + (index % 3) * 0.03).toFixed(2);
    return `component C${index + 1} [${evolution}, ${visibility}] label [18, -12]`;
  });
  const links = Array.from({ length: 45 }, (_, index) => `C${index % 30 + 1}->C${(index + 1) % 30 + 1}`);
  sourceInput.value = ["title Complexity Diagnostics", "size [960, 640]", ...components, ...links].join("\n");
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const firstItem = diagnostics.querySelector("li")?.textContent ?? "";
  if (!firstItem.startsWith("Dense map: 30 components, 45 links")) {
    throw new Error(`Complexity diagnostics should lead with the dense-map warning, got "${firstItem}".`);
  }
  if (!diagnostics.textContent?.includes("Map size 960x640 is tight")) {
    throw new Error("Complexity diagnostics did not include a tight map-size warning.");
  }
}

async function verifyHoverFocus(window, sourceInput, previewOutput, focusPaths) {
  sourceInput.value = `title Hover Focus
component User [0.9, 0.2]
component Need [0.7, 0.45]
component Build [0.5, 0.62]
component Runtime [0.32, 0.76]
component Other [0.4, 0.18]
User->Need
Need->Build
Build->Runtime
`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const svg = previewOutput.querySelector("svg");
  const user = svg?.querySelector('[data-wardley-component-id="user"]');
  const need = svg?.querySelector('[data-wardley-component-id="need"]');
  const build = svg?.querySelector('[data-wardley-component-id="build"]');
  const runtime = svg?.querySelector('[data-wardley-component-id="runtime"]');
  const other = svg?.querySelector('[data-wardley-component-id="other"]');
  const link1 = svg?.querySelector('[data-wardley-link-id="link-1"]');
  const link2 = svg?.querySelector('[data-wardley-link-id="link-2"]');
  const link3 = svg?.querySelector('[data-wardley-link-id="link-3"]');
  if (!svg || !user || !need || !build || !runtime || !other || !link1 || !link2 || !link3) {
    throw new Error("Hover focus fixture did not render expected focus metadata.");
  }

  need.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  if (svg.getAttribute("data-wardley-focus-active") !== "true") {
    throw new Error("Hover focus did not activate the SVG focus state.");
  }
  if (!user.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the upstream component visible.");
  }
  if (!need.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the hovered component visible.");
  }
  if (!build.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the downstream component visible.");
  }
  if (!runtime.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the full downstream path visible.");
  }
  if (!link1.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the upstream path link visible.");
  }
  if (!link2.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the hovered path link visible.");
  }
  if (!link3.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus did not keep the downstream path link visible.");
  }
  if (other.classList.contains("wardley-focus-visible")) {
    throw new Error("Hover focus should not keep unrelated components visible.");
  }
  if (focusPaths.hidden) {
    throw new Error("Hover focus did not show the path focus panel.");
  }
  const focusText = focusPaths.textContent ?? "";
  for (const expected of ["Path focus", "Need", "Upstream", "User", "Downstream", "Runtime"]) {
    if (!focusText.includes(expected)) {
      throw new Error(`Hover focus path panel is missing "${expected}": ${focusText}`);
    }
  }

  svg.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (svg.hasAttribute("data-wardley-focus-active")) {
    throw new Error("Hover focus did not clear the SVG focus state on mouseleave.");
  }
  if (!focusPaths.hidden) {
    throw new Error("Hover focus did not hide the path focus panel on mouseleave.");
  }

  link2.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (!need.classList.contains("wardley-focus-visible") || !build.classList.contains("wardley-focus-visible")) {
    throw new Error("Link hover did not keep both edge endpoints visible.");
  }
  if (user.classList.contains("wardley-focus-visible") || runtime.classList.contains("wardley-focus-visible")) {
    throw new Error("Link hover should stay focused on the hovered edge, not the full path.");
  }
  if (focusPaths.hidden || !(focusPaths.textContent ?? "").includes("Direct link")) {
    throw new Error("Link hover did not show a direct link path panel.");
  }
}

async function verifyDenseAnnotationHoverMode(window, sourceInput, previewOutput) {
  sourceInput.value = `title Dense Annotation Hover
component User [0.9, 0.2]
component Need [0.7, 0.45]
User->Need
annotation 1 [0.84, 0.24] First dense annotation
annotation 2 [0.72, 0.36] Second dense annotation
annotation 3 [0.62, 0.48] Third dense annotation
annotation 4 [0.52, 0.58] Fourth dense annotation
`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const svg = previewOutput.querySelector("svg");
  const callout = svg?.querySelector('[data-wardley-callout-id="annotation-1"]');
  const body = callout?.querySelector(".wardley-callout-body");
  const trigger = callout?.querySelector(".wardley-callout-trigger");
  if (!svg || !callout || !body || !trigger) {
    throw new Error("Dense annotation fixture did not render expected annotation hover metadata.");
  }
  if (svg.getAttribute("data-wardley-annotation-mode") !== "hover") {
    throw new Error("Dense annotation fixture did not enable hover annotation mode.");
  }

  trigger.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (!callout.classList.contains("wardley-focus-visible")) {
    throw new Error("Annotation hover trigger did not focus the matching annotation callout.");
  }

  svg.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (callout.classList.contains("wardley-focus-visible")) {
    throw new Error("Annotation hover mode did not clear callout focus on mouseleave.");
  }
}

async function verifyPreviewControls(
  window,
  sourceInput,
  previewPane,
  previewOutput,
  zoomStatus,
  zoomOutButton,
  zoomFitButton,
  zoomInButton,
  fullscreenButton
) {
  const denseComponents = Array.from({ length: 30 }, (_, index) => {
    const visibility = (0.92 - (index % 10) * 0.07).toFixed(2);
    const evolution = (0.12 + Math.floor(index / 10) * 0.22 + (index % 3) * 0.03).toFixed(2);
    return `component Dense Control ${index + 1} [${evolution}, ${visibility}]`;
  });
  const denseLinks = Array.from({ length: 45 }, (_, index) => `Dense Control ${index % 30 + 1}->Dense Control ${(index + 1) % 30 + 1}`);
  sourceInput.value = ["title Dense Preview Controls", "size [960, 640]", ...denseComponents, ...denseLinks].join("\n");
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const autoSvg = previewOutput.querySelector("svg");
  if (!autoSvg) {
    throw new Error("Dense preview controls fixture did not render an SVG.");
  }
  if (previewOutput.dataset.zoom !== "auto" || !zoomStatus.textContent?.startsWith("Auto ")) {
    throw new Error(`Dense preview controls should start in auto mode, got "${previewOutput.dataset.zoom}" / "${zoomStatus.textContent}".`);
  }
  if (Number(previewOutput.dataset.renderScale ?? "1") <= 1 || autoSvg.style.maxWidth !== "none" || autoSvg.style.width !== `${autoSvg.getAttribute("width")}px`) {
    throw new Error(`Dense preview controls did not use readable auto width, got scale=${previewOutput.dataset.renderScale}, maxWidth=${autoSvg.style.maxWidth}, width=${autoSvg.style.width}.`);
  }

  zoomFitButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (previewOutput.dataset.zoom !== "fit" || autoSvg.style.width !== "" || autoSvg.style.maxWidth !== "") {
    throw new Error(`Dense preview fit did not restore responsive sizing, got "${previewOutput.dataset.zoom}" / "${autoSvg.style.width}" / "${autoSvg.style.maxWidth}".`);
  }

  sourceInput.value = `title Preview Controls
size [960, 640]
component User [0.9, 0.2]
component Need [0.7, 0.45]
User->Need
`;
  sourceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();

  const svg = previewOutput.querySelector("svg");
  if (!svg) {
    throw new Error("Preview controls fixture did not render an SVG.");
  }
  if (previewOutput.dataset.zoom !== "fit" || zoomStatus.textContent !== "Fit") {
    throw new Error(`Preview controls should start in fit mode, got "${previewOutput.dataset.zoom}" / "${zoomStatus.textContent}".`);
  }

  zoomInButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (previewOutput.dataset.zoom !== "custom" || zoomStatus.textContent !== "120%" || svg.style.width !== "1152px") {
    throw new Error(`Zoom in did not apply 120% width, got "${previewOutput.dataset.zoom}" / "${zoomStatus.textContent}" / "${svg.style.width}".`);
  }

  zoomOutButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (zoomStatus.textContent !== "100%" || svg.style.width !== "960px") {
    throw new Error(`Zoom out did not apply 100% width, got "${zoomStatus.textContent}" / "${svg.style.width}".`);
  }

  zoomFitButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (previewOutput.dataset.zoom !== "fit" || zoomStatus.textContent !== "Fit" || svg.style.width !== "") {
    throw new Error(`Zoom fit did not reset the SVG width, got "${previewOutput.dataset.zoom}" / "${zoomStatus.textContent}" / "${svg.style.width}".`);
  }

  fullscreenButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (previewPane.dataset.fullscreen !== "true" || fullscreenButton.textContent !== "Exit") {
    throw new Error("Fullscreen toggle did not enter fullscreen mode.");
  }
  fullscreenButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await window.happyDOM.whenAsyncComplete();
  if (previewPane.dataset.fullscreen !== "false" || fullscreenButton.textContent !== "Full") {
    throw new Error("Fullscreen toggle did not exit fullscreen mode.");
  }
}

async function createPreviewWindow(hash = "") {
  const html = readFileSync(join(previewDir, "index.html"), "utf8");
  const windowUrl = new URL(pathToFileURL(join(previewDir, "index.html")).href);
  windowUrl.hash = hash;
  const window = new Window({ url: windowUrl.href });
  const { document } = window;
  document.write(html);
  document.close();

  const downloads = [];
  const clipboardWrites = [];
  window.URL.createObjectURL = (blob) => {
    downloads.push({ blob });
    return `blob:wardley-preview-${downloads.length}`;
  };
  window.URL.revokeObjectURL = () => {};
  window.__wardleyDownloads = downloads;
  window.__wardleyClipboardWrites = clipboardWrites;
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: async (value) => {
        clipboardWrites.push(String(value));
      }
    },
    configurable: true
  });

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName, options) => {
    const element = originalCreateElement(tagName, options);
    if (String(tagName).toLowerCase() === "a") {
      element.click = () => {
        const last = downloads[downloads.length - 1];
        if (last) {
          last.href = element.href;
          last.download = element.download;
        }
      };
    }
    return element;
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.Blob = window.Blob;
  globalThis.URL = window.URL;
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.Event = window.Event;

  await import(`${pathToFileURL(join(previewDir, "assets", "client.js")).href}?verify=${previewImportCounter++}`);
  await window.happyDOM.whenAsyncComplete();
  return window;
}

async function clickDownload(window, button) {
  return captureDownload(
    window,
    () => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    button.id
  );
}

async function captureDownload(window, action, label) {
  const before = window.__wardleyDownloads.length;
  action();
  for (let index = 0; index < 40 && window.__wardleyDownloads.length === before; index += 1) {
    await window.happyDOM.whenAsyncComplete();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  const download = window.__wardleyDownloads[before];
  if (!download) {
    throw new Error(`Expected ${label} to create a download.`);
  }
  return download;
}

function requiredElement(document, id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing preview element: ${id}`);
  }
  return element;
}

function listWardleyFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return listWardleyFiles(path);
      }
      return [path];
    })
    .filter((path) => [".wm", ".owm"].includes(extname(path).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

function lineCount(value) {
  return value.length === 0 ? 1 : value.split(/\r?\n/u).length;
}

function sourceMetaLabel(value) {
  return `${lineCount(value)} lines, ${compactCount([...value].length)} chars`;
}

function compactCount(value) {
  if (value < 1000) {
    return String(value);
  }
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function isDenseMap(map) {
  const visualItems = map.components.length
    + map.links.length
    + map.evolutions.length
    + map.annotations.length
    + map.notes.length
    + map.markers.length
    + map.pipelines.length
    + map.attitudes.length;
  return map.components.length >= 28 || map.links.length >= 40 || visualItems >= 80;
}
