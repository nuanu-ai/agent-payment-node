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
    const lines = whole === undefined ? text.split(/\r?\n/u).filter((line) => line.trim().length > 0) : [];
    const frames = whole === undefined ? lines.slice(0, MAX_FRAMES).map((line) => frame(line)) : [frameOf(whole)];
    return { bytes: total, captured: complete ? "complete" : "truncated", sha256: complete ? sha256(bytes) : null,
        frames, framesOmitted: Math.max(0, lines.length - MAX_FRAMES) };
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