const ELLIPSIS = "...";

export interface TextBlockLayoutOptions {
  readonly fontSize: number;
  readonly fontWeight?: number | undefined;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly maxLines: number;
}

export interface TextBlockLayout {
  readonly lines: readonly string[];
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly truncated: boolean;
}

export function displayTextLength(value: string): number {
  return [...value].reduce((sum, char) => sum + glyphWidth(char), 0);
}

export function compactText(value: string, maxCharacters: number): string {
  const normalized = normalizeInlineText(value);
  if (displayTextLength(normalized) <= maxCharacters) {
    return normalized;
  }
  return `${takeByDisplayLength(normalized, Math.max(1, maxCharacters - ELLIPSIS.length)).trimEnd()}${ELLIPSIS}`;
}

export function compactTextLines(value: string, maxCharacters: number, maxLines: number): readonly string[] {
  const wrapped = wrapWords(value, maxCharacters);
  if (wrapped.length <= maxLines) {
    return wrapped.map((line) => compactText(line, maxCharacters));
  }
  const visible = wrapped.slice(0, Math.max(1, maxLines));
  const tail = wrapped.slice(maxLines - 1).join(" ");
  visible[visible.length - 1] = compactText(tail, maxCharacters);
  return visible;
}

export function layoutTextBlock(value: string, options: TextBlockLayoutOptions): TextBlockLayout {
  const maxWidth = Math.max(1, options.maxWidth);
  const maxLines = Math.max(1, options.maxLines);
  const fontWeight = options.fontWeight ?? 400;
  const wrapped = wrapTextByWidth(value, maxWidth, options.fontSize, fontWeight);
  const visible = wrapped.slice(0, maxLines);
  let truncated = wrapped.length > maxLines;
  if (truncated) {
    visible[visible.length - 1] = compactTextToWidth(wrapped.slice(maxLines - 1).join(" "), maxWidth, options.fontSize, fontWeight);
  }
  for (let index = 0; index < visible.length; index += 1) {
    const compacted = compactTextToWidth(visible[index] ?? "", maxWidth, options.fontSize, fontWeight);
    if (compacted !== visible[index]) {
      truncated = true;
      visible[index] = compacted;
    }
  }
  const lines = visible.length > 0 ? visible : [""];
  return {
    lines,
    text: lines.join("\n"),
    width: Math.min(maxWidth, Math.max(...lines.map((line) => estimateTextWidth(line, options.fontSize, fontWeight)))),
    height: lines.length * options.lineHeight + 3,
    truncated
  };
}

export function wrapWords(value: string, maxCharacters: number): string[] {
  const lines = value.split(/\r?\n/u).flatMap((line) => wrapLine(line, maxCharacters));
  return lines.length > 0 ? lines : [""];
}

export function estimateTextWidth(value: string, fontSize: number, fontWeight = 400): number {
  const weightFactor = fontWeight >= 600 ? 0.64 : 0.58;
  return Math.ceil(displayTextLength(value) * fontSize * weightFactor);
}

function wrapTextByWidth(value: string, maxWidth: number, fontSize: number, fontWeight: number): string[] {
  const lines = value.split(/\r?\n/u).flatMap((line) => wrapLineByWidth(line, maxWidth, fontSize, fontWeight));
  return lines.length > 0 ? lines : [""];
}

function wrapLineByWidth(value: string, maxWidth: number, fontSize: number, fontWeight: number): string[] {
  const words = value.split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return [value];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const pieces = splitByTextWidth(word, maxWidth, fontSize, fontWeight);
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (estimateTextWidth(next, fontSize, fontWeight) > maxWidth && current) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function splitByTextWidth(value: string, maxWidth: number, fontSize: number, fontWeight: number): readonly string[] {
  if (estimateTextWidth(value, fontSize, fontWeight) <= maxWidth) {
    return [value];
  }
  const pieces: string[] = [];
  let current = "";
  for (const char of value) {
    const next = `${current}${char}`;
    if (current && estimateTextWidth(next, fontSize, fontWeight) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

function compactTextToWidth(value: string, maxWidth: number, fontSize: number, fontWeight: number): string {
  const normalized = normalizeInlineText(value);
  if (estimateTextWidth(normalized, fontSize, fontWeight) <= maxWidth) {
    return normalized;
  }
  const ellipsisWidth = estimateTextWidth(ELLIPSIS, fontSize, fontWeight);
  let output = "";
  for (const char of normalized) {
    const next = `${output}${char}`;
    if (estimateTextWidth(next, fontSize, fontWeight) + ellipsisWidth > maxWidth) {
      break;
    }
    output = next;
  }
  return `${output.trimEnd() || normalized.slice(0, 1)}${ELLIPSIS}`;
}

function wrapLine(value: string, maxCharacters: number): string[] {
  const words = value.split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return [value];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const pieces = splitByDisplayLength(word, maxCharacters);
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (displayTextLength(next) > maxCharacters && current) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function splitByDisplayLength(value: string, maxCharacters: number): readonly string[] {
  if (displayTextLength(value) <= maxCharacters) {
    return [value];
  }
  const pieces: string[] = [];
  let current = "";
  let length = 0;
  for (const char of value) {
    const width = glyphWidth(char);
    if (current && length + width > maxCharacters) {
      pieces.push(current);
      current = char;
      length = width;
    } else {
      current += char;
      length += width;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

function takeByDisplayLength(value: string, maxCharacters: number): string {
  let output = "";
  let length = 0;
  for (const char of value) {
    const width = glyphWidth(char);
    if (length + width > maxCharacters) {
      break;
    }
    output += char;
    length += width;
  }
  return output;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function glyphWidth(char: string): number {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char) ? 2 : 1;
}
