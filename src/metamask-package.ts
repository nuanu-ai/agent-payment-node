import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";

export const METAMASK_AGENT_WALLET_VERSION = "6.1.5" as const;
export const METAMASK_AGENT_WALLET_BIN = "dist/index.js" as const;
export const METAMASK_AGENT_WALLET_INTEGRITY = "sha512-ZvLxHVCExbh2qsjTuLXXyjTXKc4kGQRuoGgW8ui52K+w4eq9R6XwtrvSrCJJh6/c5zzIHqMC1yi2kgoUBs+z8Q==" as const;
export const METAMASK_AGENT_WALLET_SHASUM = "6fcfb2d3b376a9495ef053b2d6b98cecf842e29a" as const;
export const METAMASK_PROCESS_TIMEOUT_MS = 30_000;
export const METAMASK_FOREGROUND_TIMEOUT_MS = 10 * 60_000;

export async function resolveMetaMaskBin(): Promise<string> {
  const require = createRequire(import.meta.url);
  let manifestPath: string;
  try {
    manifestPath = require.resolve("@metamask/agent-wallet/package.json");
  } catch {
    throw providerFailure("The exact MetaMask Agent Wallet client is not installed.");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    throw providerFailure("The MetaMask Agent Wallet client manifest is unavailable.");
  }
  if (!isPlainRecord(value)) throw providerProtocol();
  const bin = isPlainRecord(value.bin) && typeof value.bin.mm === "string" ? value.bin.mm : undefined;
  const repository = isPlainRecord(value.repository) ? value.repository.url : undefined;
  if (
    value.name !== "@metamask/agent-wallet" || value.version !== METAMASK_AGENT_WALLET_VERSION ||
    bin !== METAMASK_AGENT_WALLET_BIN || value.license !== "(MIT OR Apache-2.0)" ||
    !isPlainRecord(value.engines) || value.engines.node !== ">=22.18" || value.engines.npm !== ">=10.x" ||
    typeof repository !== "string" || !repository.includes("github.com/MetaMask/agentic")
  ) throw providerProtocol();
  const packageRoot = dirname(manifestPath);
  const script = resolve(packageRoot, bin);
  if (!script.startsWith(`${packageRoot}/`)) throw providerProtocol();
  return script;
}

function providerProtocol(): ApnError {
  return new ApnError("APN_PROVIDER_PROTOCOL", "The MetaMask Agent Wallet package identity is unsupported.", { retryable: false });
}

function providerFailure(message: string): ApnError {
  return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
