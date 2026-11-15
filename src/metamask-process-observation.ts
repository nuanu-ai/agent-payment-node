import { isPlainRecord } from "./canonical.js";

/** `mm`'s JSON answer in a stream: the whole text, else the object it prints last, indented or on one line, after progress lines. */
export function metaMaskJsonAnswer(text: string): unknown {
  const trimmed = text.trim(), whole = parse(trimmed);
  if (whole !== undefined) return whole;
  const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0), block = trailingBlock(lines)?.value;
  if (block !== undefined) return block;
  const last = parse(lines.at(-1)?.trim() ?? "");
  return isPlainRecord(last) ? last : undefined;
}

/**
 * The last line that opens a top-level `{` at column 0 and, with every line after it, parses as one JSON object. `mm`
 * indents nested objects, so a column-0 `{` starts a top-level answer; scanning from the end parses well-formed output once.
 */
function trailingBlock(lines: readonly string[]): { readonly start: number; readonly value: unknown } | undefined {
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    if (lines[start] !== "{") continue;
    const value = parse(lines.slice(start).join("\n"));
    return isPlainRecord(value) ? { start, value } : undefined;
  }
  return undefined;
}

function parse(text: string): unknown {
  if (text.length === 0) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}
