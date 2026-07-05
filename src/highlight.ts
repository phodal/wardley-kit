const KEYWORDS = new Set([
  "accelerator",
  "annotations",
  "annotation",
  "anchor",
  "build",
  "buy",
  "component",
  "deaccelerator",
  "ecosystem",
  "evolution",
  "evolve",
  "market",
  "note",
  "outsource",
  "pipeline",
  "pioneers",
  "settlers",
  "size",
  "style",
  "submap",
  "title",
  "townplanners",
  "url",
  "x-axis",
  "y-axis"
]);

const TOKEN_PATTERN = /(\+'[^']*'<>|\+'[^']*'<|\+'[^']*'>|\+<>|\+<|\+>|->|\[\s*\[[^\]]+\](?:\s*,\s*\[[^\]]+\])*\s*\]|\[[^\]]*\]|\([^)]*\)|\b[a-z][a-z-]*\b|[-+]?(?:\d+(?:\.\d+)?|\.\d+))/giu;

export interface WardleyHighlightOptions {
  readonly lineNumbers?: boolean | undefined;
}

export function highlightWardleyMapHtml(source: string, options: WardleyHighlightOptions = {}): string {
  const showLineNumbers = options.lineNumbers ?? true;
  return source
    .split(/\r?\n/u)
    .map((line, index) => {
      const lineNumber = showLineNumbers
        ? `<span class="wm-token wm-line-number">${index + 1}</span>`
        : "";
      return `<span class="wm-line" data-line="${index + 1}">${lineNumber}${highlightWardleyLineHtml(line) || " "}</span>`;
    })
    .join("\n");
}

export function highlightWardleyLineHtml(line: string): string {
  const commentStart = findCommentStart(line);
  const code = commentStart === -1 ? line : line.slice(0, commentStart);
  const comment = commentStart === -1 ? "" : line.slice(commentStart);
  return `${highlightCodeHtml(code)}${comment ? `<span class="wm-token wm-comment">${escapeHtml(comment)}</span>` : ""}`;
}

function highlightCodeHtml(code: string): string {
  let cursor = 0;
  let html = "";
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const value = match[0];
    const index = match.index ?? 0;
    html += escapeHtml(code.slice(cursor, index));
    html += `<span class="wm-token ${tokenClass(value)}">${escapeHtml(value)}</span>`;
    cursor = index + value.length;
  }
  html += escapeHtml(code.slice(cursor));
  return html;
}

function tokenClass(value: string): string {
  const lower = value.toLowerCase();
  if (KEYWORDS.has(lower)) {
    return "wm-keyword";
  }
  if (/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value)) {
    return "wm-number";
  }
  if (value.startsWith("[") || value.startsWith("(")) {
    return "wm-coordinate";
  }
  if (value.includes(">") || value.includes("<")) {
    return "wm-operator";
  }
  return "wm-name";
}

function findCommentStart(raw: string): number {
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
      return index;
    }
    if (bracketDepth === 0 && char === "#" && (index === 0 || /\s/u.test(raw[index - 1]!))) {
      return index;
    }
  }
  return -1;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
