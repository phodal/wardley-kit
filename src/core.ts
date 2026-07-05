export interface SourceLocation {
  readonly filename?: string | undefined;
  readonly line: number;
  readonly column: number;
}

export interface ParseOptions {
  readonly filename?: string | undefined;
  readonly sourceType?: "module" | "script" | "unambiguous" | undefined;
}

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly filename?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}

export class StructurizrParseError extends Error {
  readonly code: string;
  readonly filename?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;

  constructor(message: string, options: { code?: string | undefined; location?: SourceLocation | undefined } = {}) {
    super(message);
    this.name = "StructurizrParseError";
    this.code = options.code ?? "S4JS_PARSE_ERROR";
    this.filename = options.location?.filename;
    this.line = options.location?.line;
    this.column = options.location?.column;
  }

  toDiagnostic(): Diagnostic {
    return {
      code: this.code,
      message: this.message,
      filename: this.filename,
      line: this.line,
      column: this.column
    };
  }
}

export function formatDiagnostic(error: unknown): string {
  if (error instanceof StructurizrParseError) {
    const position =
      error.line === undefined
        ? ""
        : ` at ${error.filename ?? "<input>"}:${error.line}:${error.column ?? 0}`;
    return `${error.code}${position}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
