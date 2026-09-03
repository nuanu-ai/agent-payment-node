import { ApnError } from "./errors.js";

const MAX_DECODED_X402_BYTES = 48 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function decodeCanonicalBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value) ||
    Buffer.byteLength(value, "ascii") > 64 * 1024) {
    throw protocol("x402 header is not canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_DECODED_X402_BYTES || bytes.toString("base64") !== value) {
    throw protocol("x402 header is oversized or has non-canonical pad bits.");
  }
  return bytes;
}

export function parseJsonWithDuplicateRejection(text: string): unknown {
  let offset = 0;
  const skipWhitespace = (): void => { while (/\s/u.test(text[offset] ?? "")) offset += 1; };
  const parseValue = (): unknown => {
    skipWhitespace();
    const token = text[offset];
    if (token === "{") return parseObject();
    if (token === "[") return parseArray();
    if (token === '"') return parseString();
    if (text.startsWith("true", offset)) { offset += 4; return true; }
    if (text.startsWith("false", offset)) { offset += 5; return false; }
    if (text.startsWith("null", offset)) { offset += 4; return null; }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(offset));
    if (match === null) throw protocol("x402 JSON syntax is invalid.");
    offset += match[0].length;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number)) throw protocol("x402 JSON contains an unsafe or non-integral number.");
    return number;
  };
  const parseObject = (): Record<string, unknown> => {
    offset += 1;
    skipWhitespace();
    const object: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (text[offset] === "}") { offset += 1; return object; }
    while (true) {
      skipWhitespace();
      if (text[offset] !== '"') throw protocol("x402 JSON object key is invalid.");
      const key = parseString();
      if (keys.has(key)) throw protocol("x402 JSON contains a duplicate member name.");
      keys.add(key);
      skipWhitespace();
      if (text[offset] !== ":") throw protocol("x402 JSON object separator is invalid.");
      offset += 1;
      object[key] = parseValue();
      skipWhitespace();
      if (text[offset] === "}") { offset += 1; return object; }
      if (text[offset] !== ",") throw protocol("x402 JSON object delimiter is invalid.");
      offset += 1;
    }
  };
  const parseArray = (): unknown[] => {
    offset += 1;
    skipWhitespace();
    const array: unknown[] = [];
    if (text[offset] === "]") { offset += 1; return array; }
    while (true) {
      array.push(parseValue());
      skipWhitespace();
      if (text[offset] === "]") { offset += 1; return array; }
      if (text[offset] !== ",") throw protocol("x402 JSON array delimiter is invalid.");
      offset += 1;
    }
  };
  const parseString = (): string => {
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset];
      if (!escaped && character === '"') {
        offset += 1;
        try { return JSON.parse(text.slice(start, offset)) as string; }
        catch { throw protocol("x402 JSON string is invalid."); }
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      offset += 1;
    }
    throw protocol("x402 JSON string is unterminated.");
  };
  const value = parseValue();
  skipWhitespace();
  if (offset !== text.length) throw protocol("x402 JSON has trailing data.");
  return value;
}

function protocol(message: string): ApnError {
  return new ApnError("APN_HTTP_PROTOCOL", message);
}
