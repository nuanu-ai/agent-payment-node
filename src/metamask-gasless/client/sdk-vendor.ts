import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../../vendor/metamask-evm-sdk/", import.meta.url);
const MANIFEST_SHA256 = "0d85528a42112636bf1d6e6d7d4b82301dd11011725f61d75c5ee6780ba5f9f2";
const MAX_BYTES = 12 * 1024 * 1024;
const entries = new Set(["sdk-root", "sdk-base", "sdk-evm", "fox-evm", "fox-keyring", "controller"]);
let verified = false;
function reject(): never { throw new Error("APN EVM SDK vendor integrity rejected"); }
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
export const agentSdk = () => load<Pick<typeof import("@metamask/agent-sdk"),
  "NetworkRegistry" | "PriceService" | "createWalletServiceFromSession" | "disableAnalytics">>("sdk-root");
export const agentBase = () => load<Pick<typeof import("@metamask/agent-sdk/base"),
  "SessionManager" | "WalletStateManager">>("sdk-base");
export const agentEvm = () => load<Pick<typeof import("@metamask/agent-sdk/evm"),
  "getAgenticEvmChains" | "withEvmRpcTarget">>("sdk-evm");
export const foxEvm = () => load<Pick<typeof import("@metamask/fox-sdk/wallets/evm"),
  "prepareDelegation" | "executionsToWire" | "unsignedDelegationToWire" | "EvmServerAdapter" | "evmServerAdapter" | "SIGN_REQUEST_KIND">>("fox-evm");
export const foxKeyring = () => load<Pick<typeof import("@metamask/fox-sdk/wallets/keyring"),
  "createKeyringController" | "KEYRING_KIND">>("fox-keyring");
export const ethereumControllers = () => load<Pick<typeof import("@toruslabs/ethereum-controllers"),
  "getDelegationHashOffchain">>("controller");
