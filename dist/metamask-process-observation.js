import { isPlainRecord, sha256 } from "./canonical.js";
import { METAMASK_AGENT_WALLET_SHASUM, METAMASK_AGENT_WALLET_VERSION } from "./metamask-package.js";
const ENUM_KEYS = new Set(["ok", "code", "kind", "status", "mode", "chainNamespace"]);
const KEY = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/u, ENUM = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const MAX_KEYS = 32, MAX_FRAMES = 8;
export function observeMetaMaskProcess(input) {
    return Object.freeze({
        provider: { package: "@metamask/agent-wallet", version: METAMASK_AGENT_WALLET_VERSION, shasum: METAMASK_AGENT_WALLET_SHASUM },
        outcome: input.outcome, exitCode: input.exitCode, signal: input.signal, durationMs: input.durationMs,
        stdout: streamShape(input.stdout), stderr: streamShape(input.stderr),
    });
}
function streamShape({ bytes, total }) {
    if (total === 0)
        return { bytes: 0, captured: "empty", sha256: null, frames: [], framesOmitted: 0 };
    const complete = bytes.length === total, text = bytes.toString("utf8").trim(), whole = parse(text);
    const shape = { bytes: total, captured: complete ? "complete" : "truncated", sha256: complete ? sha256(bytes) : null };
    if (whole !== undefined)
        return { ...shape, frames: [frameOf(whole)], framesOmitted: 0 };
    const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    // `mm --json` prints its answer indented over many lines, after any progress lines: that block is one frame, kept last.
    // The last frame is always the stream's end; past eight lines the ones before it are counted, not shown.
    const tail = trailingBlock(lines);
    if (tail === undefined) {
        const kept = lines.length <= MAX_FRAMES ? lines : [...lines.slice(0, MAX_FRAMES - 1), lines.at(-1)];
        return { ...shape, frames: kept.map((line) => frame(line)), framesOmitted: lines.length - kept.length };
    }
    const before = lines.slice(0, tail.start);
    return { ...shape, frames: [...before.slice(0, MAX_FRAMES - 1).map((line) => frame(line)), frameOf(tail.value)],
        framesOmitted: Math.max(0, before.length - (MAX_FRAMES - 1)) };
}
/** `mm`'s JSON answer in a stream: the whole text, else the object it prints last, indented or on one line, after progress lines. */
export function metaMaskJsonAnswer(text) {
    const trimmed = text.trim(), whole = parse(trimmed);
    if (whole !== undefined)
        return whole;
    const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0), block = trailingBlock(lines)?.value;
    if (block !== undefined)
        return block;
    const last = parse(lines.at(-1)?.trim() ?? "");
    return isPlainRecord(last) ? last : undefined;
}
/**
 * The last line that opens a top-level `{` at column 0 and, with every line after it, parses as one JSON object. `mm`
 * indents nested objects, so a column-0 `{` starts a top-level answer; scanning from the end parses well-formed output once.
 */
function trailingBlock(lines) {
    for (let start = lines.length - 1; start >= 0; start -= 1) {
        if (lines[start] !== "{")
            continue;
        const value = parse(lines.slice(start).join("\n"));
        return isPlainRecord(value) ? { start, value } : undefined;
    }
    return undefined;
}
function frame(line) {
    const value = parse(line.trim());
    return value === undefined ? { json: false, bytes: Buffer.byteLength(line, "utf8") } : frameOf(value);
}
function frameOf(value) {
    return isPlainRecord(value) ? { json: true, type: "object", object: objectShape(value, true) } : { json: true, type: typeOf(value) };
}
function objectShape(value, nest) {
    const named = Object.keys(value).filter((key) => KEY.test(key)), keys = named.slice(0, MAX_KEYS).map((key) => {
        const item = value[key], type = typeOf(item);
        const shown = ENUM_KEYS.has(key) && (typeof item === "boolean" || typeof item === "string" && ENUM.test(item)) ? { value: item } : {};
        return { key, type, ...shown, ...(nest && isPlainRecord(item) ? { object: objectShape(item, false) } : {}) };
    });
    return { keys, otherKeys: Object.keys(value).length - keys.length };
}
function typeOf(value) {
    return value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object"
        : typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean";
}
function parse(text) {
    if (text.length === 0)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=metamask-process-observation.js.map