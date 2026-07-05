import { StructurizrParseError, type SourceLocation } from "./core.js";
import type {
  WardleyAnnotation,
  WardleyAttitudeArea,
  WardleyAttitudeKind,
  WardleyComponent,
  WardleyComponentKind,
  WardleyEvolution,
  WardleyLabelOffset,
  WardleyLink,
  WardleyLinkKind,
  WardleyMap,
  WardleyMarker,
  WardleyMarkerKind,
  WardleyMethod,
  WardleyMethodKind,
  WardleyNote,
  WardleyParseOptions,
  WardleyPipeline,
  WardleyPipelineComponent,
  WardleyUrl,
  WardleyValidationResult
} from "./types.js";

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 640;
const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d+)?|\.\d+)`;
const COMPONENT_KEYWORDS = new Set<WardleyComponentKind>(["component", "anchor", "submap", "market", "ecosystem"]);
const ATTITUDE_KEYWORDS = new Set<WardleyAttitudeKind>(["pioneers", "settlers", "townplanners"]);
const METHOD_KEYWORDS = new Set<WardleyMethodKind>(["build", "buy", "outsource"]);
const MARKER_KEYWORDS = new Set<WardleyMarkerKind>(["accelerator", "deaccelerator"]);
const STRUCTURAL_DECORATORS = new Set(["inertia", "market", "ecosystem", "build", "buy", "outsource"]);

interface ParsedLine {
  readonly raw: string;
  readonly text: string;
  readonly line: number;
}

interface ActivePipeline {
  readonly name: string;
  readonly location: SourceLocation;
  readonly components: WardleyPipelineComponent[];
}

export class WardleyParseError extends StructurizrParseError {
  constructor(message: string, options: { code?: string | undefined; location?: SourceLocation | undefined } = {}) {
    super(message, { code: options.code ?? "S4WARDLEY_PARSE_ERROR", location: options.location });
    this.name = "WardleyParseError";
  }
}

export function parseWardleyMap(source: string, options: WardleyParseOptions = {}): WardleyMap {
  return new WardleyParser(source, options).parse();
}

export function validateWardleyMap(source: string, options: WardleyParseOptions = {}): WardleyValidationResult {
  try {
    return {
      valid: true,
      diagnostics: [],
      map: parseWardleyMap(source, options)
    };
  } catch (error) {
    if (error instanceof StructurizrParseError) {
      return {
        valid: false,
        diagnostics: [error.toDiagnostic()]
      };
    }
    throw error;
  }
}

class WardleyParser {
  private readonly components: WardleyComponent[] = [];
  private readonly links: WardleyLink[] = [];
  private readonly evolutions: WardleyEvolution[] = [];
  private readonly pipelines: WardleyPipeline[] = [];
  private readonly annotations: WardleyAnnotation[] = [];
  private readonly notes: WardleyNote[] = [];
  private readonly urls: WardleyUrl[] = [];
  private readonly attitudes: WardleyAttitudeArea[] = [];
  private readonly methods: WardleyMethod[] = [];
  private readonly markers: WardleyMarker[] = [];
  private annotationsLegend: { visibility: number; evolution: number } | undefined;
  private evolutionAxis: { labels: readonly string[]; sourceLocation?: SourceLocation | undefined } | undefined;
  private yAxis: { labels: readonly string[]; sourceLocation?: SourceLocation | undefined } | undefined;
  private title = "Wardley Map";
  private style?: string;
  private size = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  private activePipeline: ActivePipeline | undefined;

  constructor(
    private readonly source: string,
    private readonly options: WardleyParseOptions
  ) {}

  parse(): WardleyMap {
    for (const line of sourceLines(this.source)) {
      if (line.text.length === 0) {
        continue;
      }
      this.parseLine(line);
    }
    if (this.activePipeline) {
      this.fail("Unclosed pipeline block.", "S4WARDLEY_UNCLOSED_PIPELINE", this.activePipeline.location);
    }
    this.validateReferences();
    const methodByName = new Map(this.methods.map((method) => [method.componentName.toLowerCase(), method.method]));
    const components = this.components.map((component) => {
      const method = methodByName.get(component.name.toLowerCase()) ?? component.method;
      return method && method !== component.method ? { ...component, method } : component;
    });

    const map: WardleyMap = {
      title: this.title,
      size: this.size,
      components,
      links: this.links,
      evolutions: this.evolutions,
      pipelines: this.pipelines,
      annotations: this.annotations,
      notes: this.notes,
      urls: this.urls,
      attitudes: this.attitudes,
      methods: this.methods,
      markers: this.markers
    };
    return {
      ...map,
      ...(this.annotationsLegend ? { annotationsLegend: this.annotationsLegend } : {}),
      ...(this.evolutionAxis ? { evolutionAxis: this.evolutionAxis } : {}),
      ...(this.yAxis ? { yAxis: this.yAxis } : {}),
      ...(this.style === undefined ? {} : { style: this.style }),
      ...(this.options.includeSource ? { source: this.source } : {})
    };
  }

  private parseLine(line: ParsedLine): void {
    if (line.text === "{") {
      if (!this.activePipeline) {
        this.fail("Unexpected pipeline block opener.", "S4WARDLEY_UNEXPECTED_BLOCK", this.location(line));
      }
      return;
    }
    if (line.text === "}") {
      this.closePipeline(line);
      return;
    }

    if (this.activePipeline) {
      if (line.text.startsWith("component ")) {
        this.parsePipelineComponent(line);
        return;
      }
      if (line.text.startsWith("evolve ")) {
        this.parseEvolution(line);
        return;
      }
      this.fail("Only component statements are supported inside a pipeline block.", "S4WARDLEY_INVALID_PIPELINE_STATEMENT", this.location(line));
    }

    const keyword = firstWord(line.text);
    if (keyword === "title") {
      this.title = unquote(line.text.slice("title".length).trim()) || this.title;
      return;
    }
    if (keyword === "style") {
      this.style = line.text.slice("style".length).trim();
      return;
    }
    if (keyword === "size") {
      this.parseSize(line);
      return;
    }
    if (keyword === "pipeline") {
      this.parsePipeline(line);
      return;
    }
    if (keyword === "evolve") {
      this.parseEvolution(line);
      return;
    }
    if (keyword === "annotation") {
      this.parseAnnotation(line);
      return;
    }
    if (keyword === "annotations") {
      this.parseAnnotationsLegend(line);
      return;
    }
    if (keyword === "note") {
      this.parseNote(line);
      return;
    }
    if (keyword === "url") {
      this.parseUrl(line);
      return;
    }
    if (COMPONENT_KEYWORDS.has(keyword as WardleyComponentKind)) {
      this.parseComponent(line, keyword as WardleyComponentKind);
      return;
    }
    if (ATTITUDE_KEYWORDS.has(keyword as WardleyAttitudeKind)) {
      this.parseAttitude(line, keyword as WardleyAttitudeKind);
      return;
    }
    if (METHOD_KEYWORDS.has(keyword as WardleyMethodKind)) {
      this.parseMethod(line, keyword as WardleyMethodKind);
      return;
    }
    if (MARKER_KEYWORDS.has(keyword as WardleyMarkerKind)) {
      this.parseMarker(line, keyword as WardleyMarkerKind);
      return;
    }
    if (keyword === "evolution" || keyword === "x-axis") {
      this.parseEvolutionAxis(line, keyword);
      return;
    }
    if (keyword === "y-axis") {
      this.parseYAxis(line);
      return;
    }
    if (this.parseLink(line)) {
      return;
    }

    this.fail(`Unsupported Wardley statement "${line.text}".`, "S4WARDLEY_UNSUPPORTED_STATEMENT", this.location(line));
  }

  private parseSize(line: ParsedLine): void {
    const match = line.text.match(/^size\s+\[([^\]]+)\]$/u);
    if (!match) {
      this.fail("Expected size [width, height].", "S4WARDLEY_INVALID_SIZE", this.location(line));
    }
    const values = parseNumberList(match[1]!, 2, this.location(line));
    const [width, height] = [values[0]!, values[1]!];
    if (width <= 0 || height <= 0) {
      this.fail("Map size values must be positive.", "S4WARDLEY_INVALID_SIZE", this.location(line));
    }
    this.size = { width, height };
  }

  private parseComponent(line: ParsedLine, kind: WardleyComponentKind): void {
    const prefix = `${kind} `;
    const body = line.text.slice(prefix.length).trim();
    const parsed = !/\[[^\]]*\]/u.test(body)
      ? parseNamedElement(body, this.location(line))
      : parseNamedCoordinates(body, kind === "anchor" || kind === "submap" ? 0 : 2, this.location(line));
    const details = parseComponentDetails(parsed.trailing, this.location(line));
    const componentKind = details.kind ?? kind;
    const component = this.createComponent({
      kind: componentKind,
      name: parsed.name,
      visibility: parsed.values[0] ?? defaultVisibility(kind),
      evolution: parsed.values[1] ?? defaultEvolution(kind),
      label: details.label,
      decorators: details.decorators,
      inertia: details.inertia,
      method: details.method,
      submapUrlId: details.submapUrlId,
      location: this.location(line)
    });
    this.components.push(component);
  }

  private parsePipeline(line: ParsedLine): void {
    const body = line.text.slice("pipeline".length).trim();
    const location = this.location(line);
    if (body.endsWith("{")) {
      const name = body.slice(0, -1).trim();
      this.openPipeline(name, location);
      return;
    }

    const coordinates = body.match(/^(.*?)\s+\[([^\]]*)\]$/u);
    if (coordinates) {
      const name = coordinates[1]!.trim();
      const values = parseNumberList(coordinates[2]!, 2, location);
      assertCoordinate(values[0]!, "pipeline start evolution", location);
      assertCoordinate(values[1]!, "pipeline end evolution", location);
      this.pipelines.push({
        id: stableId(name),
        name,
        startEvolution: values[0]!,
        endEvolution: values[1]!,
        components: [],
        sourceLocation: location
      });
      return;
    }

    this.openPipeline(body, location);
  }

  private openPipeline(name: string, location: SourceLocation): void {
    if (!name) {
      this.fail("Pipeline requires a component name.", "S4WARDLEY_INVALID_PIPELINE", location);
    }
    if (this.activePipeline) {
      this.fail("Nested pipeline blocks are not supported.", "S4WARDLEY_NESTED_PIPELINE", location);
    }
    this.activePipeline = { name, location, components: [] };
  }

  private parsePipelineComponent(line: ParsedLine): void {
    const parsed = parseNamedCoordinates(line.text.slice("component".length), 1, this.location(line));
    const details = parseComponentDetails(parsed.trailing, this.location(line));
    const parent = this.componentByName(this.activePipeline!.name);
    const visibility = parsed.values.length === 1 ? parent?.visibility ?? 0.5 : parsed.values[0]!;
    const evolution = parsed.values.length === 1 ? parsed.values[0]! : parsed.values[1]!;
    assertCoordinate(visibility, "visibility", this.location(line));
    assertCoordinate(evolution, "evolution", this.location(line));

    const pipelineComponent: WardleyPipelineComponent = {
      name: parsed.name,
      visibility,
      evolution,
      ...(details.label ? { label: details.label } : {}),
      sourceLocation: this.location(line)
    };
    this.activePipeline!.components.push(pipelineComponent);
    this.components.push(
      this.createComponent({
        kind: details.kind ?? "component",
        name: parsed.name,
        visibility,
        evolution,
        label: details.label,
        decorators: details.decorators,
        inertia: details.inertia,
        method: details.method,
        pipelineId: stableId(this.activePipeline!.name),
        location: this.location(line)
      })
    );
  }

  private closePipeline(line: ParsedLine): void {
    if (!this.activePipeline) {
      this.fail("Unexpected pipeline block closer.", "S4WARDLEY_UNEXPECTED_BLOCK", this.location(line));
    }
    const active = this.activePipeline;
    this.pipelines.push({
      id: stableId(active.name),
      name: active.name,
      components: [...active.components],
      sourceLocation: active.location
    });
    this.activePipeline = undefined;
  }

  private parseEvolution(line: ParsedLine): void {
    const match = line.text.match(new RegExp(String.raw`^evolve\s+(.+?)\s+(${NUMBER})(.*)$`, "u"));
    if (!match) {
      this.fail("Expected evolve Name 0.9 or evolve Name->NewName 0.9.", "S4WARDLEY_INVALID_EVOLUTION", this.location(line));
    }
    const rawName = match[1]!.trim();
    const evolution = parseNumber(match[2]!, "evolution", this.location(line));
    assertCoordinate(evolution, "evolution", this.location(line));
    const details = parseComponentDetails(match[3]!, this.location(line));
    const [sourceName, targetName] = rawName.includes("->")
      ? rawName.split("->", 2).map((value) => value.trim())
      : [rawName, undefined];
    this.evolutions.push({
      sourceName: sourceName!,
      ...(targetName ? { targetName } : {}),
      evolution,
      decorators: [
        ...(details.kind ? [details.kind] : []),
        ...(details.method ? [details.method] : []),
        ...details.decorators
      ],
      ...(details.label ? { label: details.label } : {}),
      sourceLocation: this.location(line)
    });
  }

  private parseAnnotation(line: ParsedLine): void {
    const body = line.text.slice("annotation".length).trim();
    const idMatch = body.match(/^(\S+)\s+(.*)$/u);
    if (!idMatch) {
      this.fail("Expected annotation id [visibility, evolution] text.", "S4WARDLEY_INVALID_ANNOTATION", this.location(line));
    }
    const id = idMatch[1]!;
    const rest = idMatch[2]!.trim();
    const nested = rest.match(/^\[\s*((?:\[[^\]]+\]\s*,?\s*)+)\]\s*(.*)$/u);
    if (nested) {
      const points = Array.from(nested[1]!.matchAll(/\[([^\]]+)\]/gu))
        .map((match) => parseNumberList(match[1]!, 2, this.location(line)));
      const start = points[0];
      if (!start) {
        this.fail("Expected annotation id [[visibility, evolution]] text.", "S4WARDLEY_INVALID_ANNOTATION", this.location(line));
      }
      const end = points[1];
      this.annotations.push({
        id,
        visibility: start[0]!,
        evolution: start[1]!,
        ...(end ? { visibilityEnd: end[0]!, evolutionEnd: end[1]! } : {}),
        text: nested[2]!.trim(),
        sourceLocation: this.location(line)
      });
      return;
    }
    const single = rest.match(/^\[([^\]]+)\]\s*(.*)$/u);
    if (!single) {
      this.fail("Expected annotation id [visibility, evolution] text.", "S4WARDLEY_INVALID_ANNOTATION", this.location(line));
    }
    const values = parseNumberList(single[1]!, 2, this.location(line));
    this.annotations.push({
      id,
      visibility: values[0]!,
      evolution: values[1]!,
      text: single[2]!.trim(),
      sourceLocation: this.location(line)
    });
  }

  private parseAnnotationsLegend(line: ParsedLine): void {
    const match = line.text.match(/^annotations\s+\[([^\]]+)\]$/u);
    if (!match) {
      this.fail("Expected annotations [visibility, evolution].", "S4WARDLEY_INVALID_ANNOTATIONS", this.location(line));
    }
    const values = parseNumberList(match[1]!, 2, this.location(line));
    this.annotationsLegend = {
      visibility: values[0]!,
      evolution: values[1]!
    };
  }

  private parseNote(line: ParsedLine): void {
    const parsed = parseNamedCoordinates(line.text.slice("note".length), 2, this.location(line));
    this.notes.push({
      text: parsed.name,
      visibility: parsed.values[0]!,
      evolution: parsed.values[1]!,
      sourceLocation: this.location(line)
    });
  }

  private parseUrl(line: ParsedLine): void {
    const match = line.text.match(/^url\s+(.+?)\s+\[([^\]]+)\]$/u);
    if (!match) {
      this.fail("Expected url Name [https://example.com].", "S4WARDLEY_INVALID_URL", this.location(line));
    }
    this.urls.push({
      name: match[1]!.trim(),
      url: match[2]!.trim(),
      sourceLocation: this.location(line)
    });
  }

  private parseAttitude(line: ParsedLine, kind: WardleyAttitudeKind): void {
    const match = line.text.match(/^\S+\s+\[([^\]]+)\]\s*(.*)$/u);
    if (!match) {
      this.fail("Expected pioneers|settlers|townplanners [visibility, evolution, visibilityEnd, evolutionEnd].", "S4WARDLEY_INVALID_ATTITUDE", this.location(line));
    }
    const values = parseNumberSequence(match[1]!, this.location(line));
    const location = this.location(line);
    if (values.length === 4) {
      for (const value of values) {
        assertCoordinate(value, "attitude coordinate", location);
      }
      this.attitudes.push({
        id: `${kind}-${this.attitudes.length + 1}`,
        kind,
        visibility: values[0]!,
        evolution: values[1]!,
        visibilityEnd: values[2]!,
        evolutionEnd: values[3]!,
        sourceLocation: location
      });
      return;
    }
    if (values.length === 2) {
      for (const value of values) {
        assertCoordinate(value, "attitude coordinate", location);
      }
      const sizeValues = match[2]!.trim().split(/\s+/u).filter(Boolean);
      if (sizeValues.length !== 2) {
        this.fail("Two-value attitude blocks require width and height pixel values.", "S4WARDLEY_INVALID_ATTITUDE", location);
      }
      const width = parseNumber(sizeValues[0]!, "attitude width", location);
      const height = parseNumber(sizeValues[1]!, "attitude height", location);
      if (width <= 0 || height <= 0) {
        this.fail("Attitude block width and height must be positive.", "S4WARDLEY_INVALID_ATTITUDE", location);
      }
      this.attitudes.push({
        id: `${kind}-${this.attitudes.length + 1}`,
        kind,
        visibility: values[0]!,
        evolution: values[1]!,
        width,
        height,
        sourceLocation: location
      });
      return;
    }
    this.fail("Attitude blocks require either two coordinates plus width/height or four coordinates.", "S4WARDLEY_INVALID_ATTITUDE", location);
  }

  private parseMethod(line: ParsedLine, method: WardleyMethodKind): void {
    const componentName = unquote(line.text.slice(method.length).trim());
    if (!componentName) {
      this.fail(`${method} requires a component name.`, "S4WARDLEY_INVALID_METHOD", this.location(line));
    }
    this.methods.push({
      componentName,
      method,
      sourceLocation: this.location(line)
    });
  }

  private parseMarker(line: ParsedLine, kind: WardleyMarkerKind): void {
    const parsed = parseNamedCoordinates(line.text.slice(kind.length), 2, this.location(line));
    const details = parseComponentDetails(parsed.trailing, this.location(line));
    this.markers.push({
      id: stableId(`${kind}-${parsed.name}`),
      name: parsed.name,
      kind,
      visibility: parsed.values[0]!,
      evolution: parsed.values[1]!,
      ...(details.label ? { label: details.label } : {}),
      sourceLocation: this.location(line)
    });
  }

  private parseEvolutionAxis(line: ParsedLine, keyword: string): void {
    const labels = parseAxisLabels(line.text.slice(keyword.length).trim(), this.location(line), keyword);
    this.evolutionAxis = {
      labels,
      sourceLocation: this.location(line)
    };
  }

  private parseYAxis(line: ParsedLine): void {
    const labels = parseAxisLabels(line.text.slice("y-axis".length).trim(), this.location(line), "y-axis");
    this.yAxis = {
      labels,
      sourceLocation: this.location(line)
    };
  }

  private parseLink(line: ParsedLine): boolean {
    const patterns: Array<[RegExp, WardleyLinkKind]> = [
      [/^(.+?)\+'([^']*)'<>(.+?)(?:\s*;\s*(.+))?$/u, "bidirectional-flow"],
      [/^(.+?)\+'([^']*)'<(.+?)(?:\s*;\s*(.+))?$/u, "reverse-flow"],
      [/^(.+?)\+'([^']*)'>(.+?)(?:\s*;\s*(.+))?$/u, "flow"],
      [/^(.+?)\+<>(.+?)(?:\s*;\s*(.+))?$/u, "bidirectional-flow"],
      [/^(.+?)\+<(.+?)(?:\s*;\s*(.+))?$/u, "reverse-flow"],
      [/^(.+?)\+>(.+?)(?:\s*;\s*(.+))?$/u, "flow"],
      [/^(.+?)->(.+?)(?:\s*;\s*(.+))?$/u, "dependency"]
    ];
    for (const [pattern, kind] of patterns) {
      const match = line.text.match(pattern);
      if (!match) {
        continue;
      }
      const hasFlowLabel = pattern.source.includes("\\+'");
      const sourceName = match[1]!.trim();
      const flowLabel = hasFlowLabel ? match[2]!.trim() : undefined;
      const targetName = (hasFlowLabel ? match[3]! : match[2]!).trim();
      const context = (hasFlowLabel ? match[4] : match[3])?.trim();
      this.links.push({
        sourceName,
        targetName,
        kind,
        ...(flowLabel ? { flowLabel } : {}),
        ...(context ? { context } : {}),
        sourceLocation: this.location(line)
      });
      return true;
    }
    return false;
  }

  private createComponent(input: {
    readonly kind: WardleyComponentKind;
    readonly name: string;
    readonly visibility: number;
    readonly evolution: number;
    readonly label?: WardleyLabelOffset | undefined;
    readonly decorators: readonly string[];
    readonly inertia: boolean;
    readonly method?: WardleyMethodKind | undefined;
    readonly pipelineId?: string | undefined;
    readonly submapUrlId?: string | undefined;
    readonly location: SourceLocation;
  }): WardleyComponent {
    if (!input.name) {
      this.fail("Component name is required.", "S4WARDLEY_INVALID_COMPONENT", input.location);
    }
    assertCoordinate(input.visibility, "visibility", input.location);
    assertCoordinate(input.evolution, "evolution", input.location);
    const component: WardleyComponent = {
      id: stableId(input.name),
      name: input.name,
      kind: input.kind,
      visibility: input.visibility,
      evolution: input.evolution,
      decorators: input.decorators,
      inertia: input.inertia,
      sourceLocation: input.location
    };
    return {
      ...component,
      ...(input.label ? { label: input.label } : {}),
      ...(input.method ? { method: input.method } : {}),
      ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
      ...(input.submapUrlId ? { submapUrlId: input.submapUrlId } : {})
    };
  }

  private validateReferences(): void {
    const seen = new Set<string>();
    for (const component of this.components) {
      const key = component.name.toLowerCase();
      if (seen.has(key)) {
        this.fail(`Duplicate component "${component.name}".`, "S4WARDLEY_DUPLICATE_COMPONENT", component.sourceLocation);
      }
      seen.add(key);
    }
    for (const link of this.links) {
      if (!this.componentByName(link.sourceName)) {
        this.fail(`Link references unknown source component "${link.sourceName}".`, "S4WARDLEY_UNKNOWN_COMPONENT", link.sourceLocation);
      }
      if (!this.componentByName(link.targetName)) {
        this.fail(`Link references unknown target component "${link.targetName}".`, "S4WARDLEY_UNKNOWN_COMPONENT", link.sourceLocation);
      }
    }
    for (const evolution of this.evolutions) {
      if (!this.componentByName(evolution.sourceName)) {
        this.fail(`Evolution references unknown component "${evolution.sourceName}".`, "S4WARDLEY_UNKNOWN_COMPONENT", evolution.sourceLocation);
      }
    }
    for (const pipeline of this.pipelines) {
      const isStandaloneRange = pipeline.startEvolution !== undefined && pipeline.endEvolution !== undefined;
      if (!isStandaloneRange && !this.componentByName(pipeline.name)) {
        this.fail(`Pipeline references unknown component "${pipeline.name}".`, "S4WARDLEY_UNKNOWN_COMPONENT", pipeline.sourceLocation);
      }
    }
    for (const method of this.methods) {
      if (!this.componentByName(method.componentName)) {
        this.fail(`Method references unknown component "${method.componentName}".`, "S4WARDLEY_UNKNOWN_COMPONENT", method.sourceLocation);
      }
    }
  }

  private componentByName(name: string): WardleyComponent | undefined {
    return this.components.find((component) => component.name.toLowerCase() === name.toLowerCase());
  }

  private location(line: ParsedLine): SourceLocation {
    return {
      filename: this.options.filename,
      line: line.line,
      column: Math.max(1, line.raw.indexOf(line.text) + 1)
    };
  }

  private fail(message: string, code: string, location?: SourceLocation): never {
    throw new WardleyParseError(message, { code, location });
  }
}

function sourceLines(source: string): ParsedLine[] {
  return source.split(/\r?\n/u).map((raw, index) => ({
    raw,
    text: stripComment(raw).trim(),
    line: index + 1
  }));
}

function stripComment(raw: string): string {
  let quote: string | undefined;
  let bracketDepth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    const next = raw[index + 1];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (bracketDepth === 0 && char === "/" && next === "/") {
      return raw.slice(0, index);
    }
    if (bracketDepth === 0 && char === "#" && (index === 0 || /\s/u.test(raw[index - 1]!))) {
      return raw.slice(0, index);
    }
  }
  return raw;
}

function firstWord(value: string): string {
  return value.match(/^\S+/u)?.[0] ?? "";
}

function parseNamedCoordinates(
  source: string,
  minValues: 0 | 1 | 2,
  location: SourceLocation
): { name: string; values: number[]; trailing: string } {
  const match = source.trim().match(/^(.*?)\s+\[([^\]]*)\](.*)$/u);
  if (!match) {
    throw new WardleyParseError("Expected name followed by coordinates in square brackets.", {
      code: "S4WARDLEY_COORDINATES_EXPECTED",
      location
    });
  }
  const values = parseNumberList(match[2]!, minValues, location);
  return {
    name: unquote(match[1]!.trim()),
    values,
    trailing: match[3] ?? ""
  };
}

function parseNamedElement(source: string, location: SourceLocation): { name: string; values: number[]; trailing: string } {
  const trimmed = source.trim();
  const match = trimmed.match(/^(.*?)(\s+(?:label\b|url\s*\(|inertia\b|\([^)]*\)).*)$/u);
  const name = unquote((match ? match[1] : trimmed)!.trim());
  if (!name) {
    throw new WardleyParseError("Component name is required.", {
      code: "S4WARDLEY_INVALID_COMPONENT",
      location
    });
  }
  return {
    name,
    values: [],
    trailing: match?.[2] ?? ""
  };
}

function parseComponentDetails(source: string, location: SourceLocation): {
  label?: WardleyLabelOffset | undefined;
  decorators: readonly string[];
  inertia: boolean;
  kind?: "market" | "ecosystem" | undefined;
  method?: WardleyMethodKind | undefined;
  submapUrlId?: string | undefined;
} {
  const labelMatch = source.match(/\blabel\s+\[([^\]]+)\]/u);
  const labelValues = labelMatch ? parseNumberList(labelMatch[1]!, 2, location) : undefined;
  const submapUrlMatch = source.match(/\burl\s*\(([^)]*)\)/u);
  const decorators = Array.from(source.matchAll(/\(([^)]*)\)/gu))
    .flatMap((match) => match[1]!.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const lowerDecorators = decorators.map((decorator) => decorator.toLowerCase());
  const inertia = /\binertia\b/u.test(source) || lowerDecorators.includes("inertia");
  const kind = lowerDecorators.includes("market") ? "market" : lowerDecorators.includes("ecosystem") ? "ecosystem" : undefined;
  const method = lowerDecorators.find((decorator): decorator is WardleyMethodKind => METHOD_KEYWORDS.has(decorator as WardleyMethodKind));
  const result = {
    decorators: decorators.filter((decorator) => !STRUCTURAL_DECORATORS.has(decorator.toLowerCase())),
    inertia
  };
  return {
    ...result,
    ...(kind ? { kind } : {}),
    ...(method ? { method } : {}),
    ...(submapUrlMatch?.[1]?.trim() ? { submapUrlId: unquote(submapUrlMatch[1]!.trim()) } : {}),
    ...(labelValues ? { label: { x: labelValues[0]!, y: labelValues[1]! } } : {})
  };
}

function parseNumberList(source: string, minValues: 0 | 1 | 2, location: SourceLocation): number[] {
  const values = parseNumberSequence(source, location);
  if (values.length < minValues) {
    throw new WardleyParseError(`Expected at least ${minValues} coordinate value${minValues === 1 ? "" : "s"}.`, {
      code: "S4WARDLEY_INVALID_COORDINATES",
      location
    });
  }
  if (values.length > 2) {
    throw new WardleyParseError("Expected at most two coordinate values.", {
      code: "S4WARDLEY_INVALID_COORDINATES",
      location
    });
  }
  return values;
}

function parseAxisLabels(source: string, location: SourceLocation, keyword: string): string[] {
  const labels = source
    .split("->")
    .map((label) => unquote(label.trim()))
    .filter(Boolean);
  if (labels.length < 2) {
    throw new WardleyParseError(`${keyword} requires at least two labels separated by ->.`, {
      code: "S4WARDLEY_INVALID_AXIS",
      location
    });
  }
  return labels;
}

function parseNumberSequence(source: string, location: SourceLocation): number[] {
  return source
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseNumber(value, "coordinate", location));
}

function parseNumber(source: string, field: string, location: SourceLocation): number {
  const value = Number.parseFloat(source);
  if (!Number.isFinite(value)) {
    throw new WardleyParseError(`Invalid ${field} value "${source}".`, {
      code: "S4WARDLEY_INVALID_NUMBER",
      location
    });
  }
  return value;
}

function assertCoordinate(value: number, field: string, location?: SourceLocation): void {
  if (value < 0 || value > 1) {
    throw new WardleyParseError(`${field} must be between 0 and 1.`, {
      code: "S4WARDLEY_COORDINATE_OUT_OF_RANGE",
      location
    });
  }
}

function stableId(name: string): string {
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

function defaultVisibility(kind: WardleyComponentKind): number {
  return kind === "anchor" ? 1 : 0.5;
}

function defaultEvolution(kind: WardleyComponentKind): number {
  return kind === "anchor" ? 0.5 : 0.5;
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/u, "$1").replace(/^'(.*)'$/u, "$1").trim();
}
