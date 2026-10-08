import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../vendor/relay-order-id/", import.meta.url);
const MANIFEST_SHA256 = "1c697732810415f01663bb774256b662c337c9cb8f0f17fbf0e22cb665e991e2";
const MAX_BYTES = 12 * 1024 * 1024;
const entries = new Set(["order-id"]);
let verified = false;
function reject(): never { throw new Error("APN Relay order-ID vendor integrity rejected"); }
function read(name: string, maximum: number): Buffer {
  const path = fileURLToPath(new URL(name, root)), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) reject();
  return readFileSync(path);
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function verify(): void {
  if (verified) return;
  const stat = lstatSync(fileURLToPath(root).replace(/\/$/u, "")); if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
  const bytes = read("manifest.json", 65536); if (digest(bytes) !== MANIFEST_SHA256) reject();
  const manifest = JSON.parse(bytes.toString("utf8")) as { files: Record<string, { bytes: number; sha256: string }> };
  let total = 0;
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_-]+\.mjs(?:\.LEGAL\.txt)?$/u.test(name)) reject();
    total += expected.bytes; if (total > MAX_BYTES) reject();
    const content = read(name, expected.bytes);
    if (content.length !== expected.bytes || digest(content) !== expected.sha256) reject();
  }
  verified = true;
}
async function load<T>(name: string): Promise<T> {
  if (!entries.has(name)) reject(); verify();
  return await import(new URL(`${name}.mjs`, root).href) as T;
}
export const getOrderId: typeof import("@relay-protocol/settlement-sdk").getOrderId =
  (await load<Pick<typeof import("@relay-protocol/settlement-sdk"), "getOrderId">>("order-id")).getOrderId;
