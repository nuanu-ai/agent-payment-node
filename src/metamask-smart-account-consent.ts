import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exactKeys, isPlainRecord } from "./canonical.js";
import type { Address } from "./model.js";
import { ApnError } from "./errors.js";
import { BASE_CHAIN_HEX, smartAccountEnvironment, smartAccountInactive } from "./metamask-smart-account-grant.js";
import { isConsentPort } from "./metamask-smart-account-record.js";

/**
 * MetaMask keeps an Advanced Permission for the exact origin that requested it and lists it only to that origin, so the
 * consent page of one permission is always served from the same loopback port: the one its record saved.
 */
export interface SmartAccountConsentRequest {
  readonly port: number;
  readonly sessionAddress: Address;
  readonly capAtomic: string;
  readonly startsAtUnix: number;
  readonly expiresAtUnix: number;
}

export interface SmartAccountConsentSync {
  readonly port: number;
  readonly ownerAddress: Address;
}

/** A loopback port the system has free now, for a new permission's consent origin; the caller saves it before use. */
export async function allocateConsentPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server, 0);
  await closeServer(server);
  if (!isConsentPort(port)) throw new ApnError("APN_INTERNAL", "The system gave no usable loopback port for MetaMask consent.");
  return port;
}

export interface SmartAccountConsentPort {
  request(input: SmartAccountConsentRequest): Promise<unknown>;
  sync(input: SmartAccountConsentSync): Promise<unknown>;
}

export type BrowserOpenPort = (url: string) => Promise<void>;

const CALLBACK_PATH = "/callback";
const MAX_BODY_BYTES = 256 * 1024;
const DEADLINE_MS = 5 * 60_000;

export class LoopbackMetaMaskConsent implements SmartAccountConsentPort {
  constructor(
    private readonly openBrowser: BrowserOpenPort = defaultOpenBrowser,
    private readonly deadlineMs = DEADLINE_MS,
  ) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > DEADLINE_MS) {
      throw new ApnError("APN_INTERNAL", "MetaMask consent deadline is invalid.");
    }
  }

  async request(input: SmartAccountConsentRequest): Promise<unknown> {
    return await this.run({ mode: "request", ...input });
  }

  async sync(input: SmartAccountConsentSync): Promise<unknown> {
    return await this.run({ mode: "sync", ...input });
  }

  private async run(config: BrowserConfig): Promise<unknown> {
    if (!isConsentPort(config.port)) throw new ApnError("APN_INTERNAL", "MetaMask consent port is invalid.");
    const token = randomBytes(32).toString("hex");
    let used = false;
    let settle: ((value: unknown) => void) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    const terminal = new Promise<unknown>((resolve, reject) => { settle = resolve; fail = reject; });
    const server = createServer((request, response) => {
      void this.handle(request, response, config, token, () => used, () => { used = true; }, settle!, fail!);
    });
    const port = await listen(server, config.port).catch((error: unknown) => {
      if ((error as { code?: unknown } | null)?.code !== "EADDRINUSE") throw error;
      throw new ApnError("APN_PROVIDER_UNAVAILABLE", `The MetaMask consent port 127.0.0.1:${config.port} of this permission is in use; ` +
        "free it and retry the same command.", { retryable: true, reason: "consent_port_in_use", consent_port: config.port, nextActions: [
        `Find what listens on 127.0.0.1:${config.port} (lsof -nP -iTCP:${config.port} -sTCP:LISTEN), stop it, then rerun the same command.`] });
    });
    const origin = `http://127.0.0.1:${port}`;
    const timer = setTimeout(() => fail?.(new ApnError(
      "APN_PROVIDER_UNAVAILABLE",
      "MetaMask foreground consent timed out safely; retry the same connect intent.",
      { retryable: true },
    )), this.deadlineMs);
    try {
      void this.openBrowser(`${origin}/#${token}`).catch(() => fail?.(new ApnError(
        "APN_PROVIDER_UNAVAILABLE",
        "The foreground browser could not be opened.",
        { retryable: true },
      )));
      return await terminal;
    } finally {
      clearTimeout(timer);
      await closeServer(server);
    }
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    config: BrowserConfig,
    token: string,
    isUsed: () => boolean,
    consume: () => void,
    resolve: (value: unknown) => void,
    reject: (error: unknown) => void,
  ): Promise<void> {
    try {
      const port = (request.socket.address() as { port?: number }).port;
      const host = `127.0.0.1:${port}`;
      if (request.headers.host !== host || request.url === undefined || request.url.includes("?")) return rejectHttp(response, reject);
      if (request.method === "GET" && request.url === "/") return serve(response, "text/html; charset=utf-8", PAGE);
      if (request.method === "GET" && request.url === "/app.js") {
        return serve(response, "text/javascript; charset=utf-8", browserScript(config));
      }
      if (request.method !== "POST" || request.url !== CALLBACK_PATH || isUsed() ||
        request.headers.origin !== `http://${host}` || request.headers["content-type"] !== "application/json") {
        return rejectHttp(response, reject);
      }
      consume();
      const body = await readBody(request);
      const parsed = JSON.parse(body) as unknown;
      if (!isCallback(parsed) || parsed.token !== token) return rejectHttp(response, reject);
      response.writeHead(204, securityHeaders());
      response.end();
      if (parsed.outcome.ok) resolve(parsed.outcome.value);
      else reject(browserFailure(parsed.outcome.code, parsed.outcome.diagnostic));
    } catch {
      rejectHttp(response, reject);
    }
  }
}

type BrowserConfig = ({ readonly mode: "request" } & SmartAccountConsentRequest) |
  ({ readonly mode: "sync" } & SmartAccountConsentSync);

const BROWSER_FAILURES = ["missing_provider", "user_rejected", "wrong_chain", "unsupported_permission",
  "inactive_account", "changed_account", "provider_protocol"] as const;
type BrowserFailure = typeof BROWSER_FAILURES[number];
/**
 * The page's last step: choosing the injected provider, the wallet method whose call or answer stopped it, or the sync
 * comparison of the selected account with the bound owner (`owner_match`).
 */
export const CONSENT_STEPS = ["provider_choice", "eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain",
  "eth_chainId", "eth_accounts", "wallet_getSupportedExecutionPermissions", "eth_getCode",
  "wallet_getGrantedExecutionPermissions", "wallet_requestExecutionPermissions", "owner_match"] as const;
const PROVIDER_MESSAGE_MAX = 160;

/**
 * Where a stopped consent stopped. `permission_requested` is true once the page sent MetaMask the permission request, so a
 * grant may exist unless MetaMask answered with a rejection. The provider code and message are the wallet's own, unverified, and present only when that wallet call itself
 * threw; the page keeps printable ASCII of the message, at most 160 characters.
 */
interface BrowserDiagnostic {
  readonly step: typeof CONSENT_STEPS[number];
  readonly permission_requested: boolean;
  readonly provider_code: number | null;
  readonly provider_message: string | null;
}

interface Callback {
  readonly token: string;
  readonly outcome: { readonly ok: true; readonly value: unknown } |
    { readonly ok: false; readonly code: BrowserFailure; readonly diagnostic: BrowserDiagnostic };
}

function isDiagnostic(value: unknown): value is BrowserDiagnostic {
  if (!isPlainRecord(value) || !exactKeys(value, ["step", "permission_requested", "provider_code", "provider_message"])) return false;
  const code = value.provider_code, message = value.provider_message;
  return (CONSENT_STEPS as readonly unknown[]).includes(value.step) && typeof value.permission_requested === "boolean" &&
    (code === null || (Number.isSafeInteger(code) && Math.abs(code as number) <= 2_147_483_648)) &&
    (message === null || (typeof message === "string" && message.length <= PROVIDER_MESSAGE_MAX && /^[\x20-\x7e]*$/u.test(message)));
}

function isCallback(value: unknown): value is Callback {
  if (!isPlainRecord(value) || !exactKeys(value, ["token", "outcome"])) return false;
  const record = value;
  if (typeof record.token !== "string" || !/^[a-f0-9]{64}$/u.test(record.token) || !isPlainRecord(record.outcome)) return false;
  const outcome = record.outcome as Record<string, unknown>;
  return outcome.ok === true
    ? exactKeys(outcome, ["ok", "value"])
    : outcome.ok === false && exactKeys(outcome, ["ok", "code", "diagnostic"]) &&
      (BROWSER_FAILURES as readonly unknown[]).includes(outcome.code) && isDiagnostic(outcome.diagnostic);
}

function browserScript(config: BrowserConfig): string {
  const environment = smartAccountEnvironment();
  const { port: _port, ...pageConfig } = config;
  const publicConfig = {
    ...pageConfig,
    chainId: BASE_CHAIN_HEX,
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    implementation: environment.implementations.EIP7702StatelessDeleGatorImpl,
    callback: CALLBACK_PATH,
  };
  return `"use strict";\nconst config=${JSON.stringify(publicConfig)};\n${BROWSER_LOGIC}`;
}

const BROWSER_LOGIC = String.raw`
const token = location.hash.slice(1);
history.replaceState(null, "", "/");
const setStatus = (value) => { document.getElementById("status").textContent = value; };
let step = "provider_choice", permissionRequested = false, walletError;
const call = async (provider, method, params) => {
  step = method;
  try { return await provider.request({ method, params }); }
  catch (error) { walletError = { error }; throw error; }
};
// The code and message are kept only for the error the last wallet call threw, never for the page's own exception.
const failure = (code, error) => {
  let providerCode = null, providerMessage = null;
  try {
    const raw = error === undefined || error === null ? undefined : error.code;
    if (typeof raw === "number" && Number.isSafeInteger(raw) && Math.abs(raw) <= 2147483648) providerCode = raw;
    const message = error === undefined || error === null ? undefined : error.message;
    if (typeof message === "string") providerMessage = message.replace(/[^\x20-\x7e]/gu, "?").slice(0, ${PROVIDER_MESSAGE_MAX});
  } catch { /* An accessor-hostile error keeps only its step. */ }
  return { ok: false, code, diagnostic: { step, permission_requested: permissionRequested, provider_code: providerCode, provider_message: providerMessage } };
};
const post = async (outcome) => {
  await fetch(config.callback, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, outcome }) });
  setStatus(outcome.ok ? "Permission accepted. You may close this tab." : "Permission stopped safely at " + outcome.diagnostic.step +
    (outcome.diagnostic.provider_code === null ? "" : " (wallet error " + outcome.diagnostic.provider_code + ")") + ". You may close this tab.");
  setTimeout(() => window.close(), 250);
};
const classify = (error) => {
  try { return error && Number(error.code) === 4001 ? "user_rejected" : "provider_protocol"; }
  catch { return "provider_protocol"; }
};
const displayText = (record, key) => {
  try {
    const value = record && record[key];
    if (typeof value !== "string" || value.trim() === "") return "Unavailable";
    return value.trim().slice(0, 160).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "�");
  } catch { return "Unavailable"; }
};
const requestCapable = (provider) => {
  try { return provider && typeof provider.request === "function"; }
  catch { return false; }
};
const discoverProviders = async () => {
  const candidates = [];
  const add = (provider, source, info) => {
    if (!requestCapable(provider) || candidates.some((candidate) => candidate.provider === provider)) return;
    candidates.push({
      provider,
      source,
      name: displayText(info, "name"),
      rdns: displayText(info, "rdns"),
      uuid: displayText(info, "uuid"),
    });
  };
  const announce = (event) => {
    try {
      const detail = event && event.detail;
      add(detail && detail.provider, "EIP-6963 announcement", detail && detail.info);
    } catch { /* Ignore malformed or accessor-hostile announcements. */ }
  };
  globalThis.addEventListener("eip6963:announceProvider", announce);
  try {
    globalThis.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally { globalThis.removeEventListener("eip6963:announceProvider", announce); }
  try {
    const injected = globalThis.ethereum;
    const providers = Array.isArray(injected && injected.providers) ? injected.providers : [];
    for (const provider of providers) add(provider, "Legacy ethereum.providers", undefined);
    add(injected, "Legacy globalThis.ethereum", undefined);
  } catch { /* Ignore malformed or accessor-hostile legacy injection. */ }
  return candidates;
};
const chooseProvider = async (candidates) => {
  if (candidates.length === 0) return undefined;
  setStatus("Choose the injected wallet provider you installed and intend to use. Identity metadata is self-reported and unverified.");
  const list = document.getElementById("providers");
  const buttons = [];
  return await new Promise((resolve) => {
    let selected = false;
    candidates.forEach((candidate, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(index + 1) + ". Source: " + candidate.source + "; Name: " + candidate.name +
        "; RDNS: " + candidate.rdns + "; UUID: " + candidate.uuid + "; identity metadata is unverified";
      button.addEventListener("click", () => {
        if (selected) return;
        selected = true;
        for (const choice of buttons) choice.disabled = true;
        setStatus("Wallet provider selected. Continue in that wallet to review the exact Base USDC cap and expiry.");
        resolve(candidate.provider);
      });
      buttons.push(button);
      item.appendChild(button);
      list.appendChild(item);
    });
  });
};
const accountCode = async (provider, owner) => await call(provider, "eth_getCode", [owner, "latest"]);
const active = (code) => typeof code === "string" && code.toLowerCase() === ("0xef0100" + config.implementation.slice(2)).toLowerCase();
const sameAccount = async (provider, owner) => {
  const accounts = await call(provider, "eth_accounts", []);
  return Array.isArray(accounts) && accounts.length > 0 && String(accounts[0]).toLowerCase() === owner.toLowerCase();
};
(async () => {
  try {
    const provider = await chooseProvider(await discoverProviders());
    if (!provider) return await post(failure("missing_provider"));
    const accounts = await call(provider, "eth_requestAccounts", []);
    if (!Array.isArray(accounts) || accounts.length === 0) return await post(failure("provider_protocol"));
    const owner = String(accounts[0]);
    try { await call(provider, "wallet_switchEthereumChain", [{ chainId: config.chainId }]); }
    catch (error) {
      if (Number(error && error.code) !== 4902) throw error;
      await call(provider, "wallet_addEthereumChain", [{ chainId: config.chainId, chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }]);
    }
    const chainId = await call(provider, "eth_chainId", []);
    if (String(chainId).toLowerCase() !== config.chainId) return await post(failure("wrong_chain"));
    if (!(await sameAccount(provider, owner))) return await post(failure("changed_account"));
    const supported = await call(provider, "wallet_getSupportedExecutionPermissions", []);
    const allowance = supported && supported["erc20-token-allowance"];
    if (!allowance || (allowance.chainIds !== undefined && (!Array.isArray(allowance.chainIds) || !allowance.chainIds.some((item) => String(item).toLowerCase() === config.chainId))) || !Array.isArray(allowance.ruleTypes) || !allowance.ruleTypes.includes("expiry")) {
      return await post(failure("unsupported_permission"));
    }
    const code = await accountCode(provider, owner);
    if (!active(code)) return await post(failure("inactive_account"));
    if (config.mode === "sync") {
      if (owner.toLowerCase() !== config.ownerAddress.toLowerCase()) { step = "owner_match"; return await post(failure("changed_account")); }
      const permission_responses = await call(provider, "wallet_getGrantedExecutionPermissions", []);
      return await post({ ok: true, value: { owner_address: owner, chain_id: chainId, account_code: code, supported_permissions: supported, permission_responses } });
    }
    const request = { chainId: config.chainId, from: owner, to: config.sessionAddress, permission: { type: "erc20-token-allowance", isAdjustmentAllowed: true, data: { tokenAddress: config.tokenAddress, allowanceAmount: "0x" + BigInt(config.capAtomic).toString(16), startTime: config.startsAtUnix, justification: "Allow this APN session to spend up to the selected Base USDC cap." } }, rules: [{ type: "expiry", data: { timestamp: config.expiresAtUnix } }] };
    if (!(await sameAccount(provider, owner)) || !active(await accountCode(provider, owner))) return await post(failure("changed_account"));
    permissionRequested = true;
    const permission_responses = await call(provider, "wallet_requestExecutionPermissions", [request]);
    const finalChain = await call(provider, "eth_chainId", []);
    if (String(finalChain).toLowerCase() !== config.chainId) return await post(failure("changed_account"));
    if (!(await sameAccount(provider, owner))) return await post(failure("changed_account"));
    const finalCode = await accountCode(provider, owner);
    if (!active(finalCode)) return await post(failure("changed_account"));
    return await post({ ok: true, value: { owner_address: owner, chain_id: finalChain, account_code: finalCode, supported_permissions: supported, permission_responses } });
  } catch (error) {
    const thrownByWallet = walletError !== undefined && walletError.error === error;
    await post(failure(thrownByWallet ? classify(error) : "provider_protocol", thrownByWallet ? error : undefined));
  }
})();`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APN MetaMask permission</title></head><body><main><h1>APN MetaMask Smart Account</h1><p id="status">Finding injected wallet providers…</p><p>Provider identity metadata is self-reported and unverified. Choose the wallet you installed and intend to use. Provider icons are not displayed.</p><ol id="providers" aria-label="Injected wallet providers"></ol></main><script src="/app.js"></script></body></html>`;

function securityHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function serve(response: ServerResponse, type: string, body: string): void {
  response.writeHead(200, { ...securityHeaders(), "content-type": type });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function rejectHttp(response: ServerResponse, reject: (error: unknown) => void): void {
  if (!response.headersSent) response.writeHead(400, securityHeaders());
  response.end();
  reject(new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask loopback consent violated its bounded protocol.", { retryable: false }));
}

function browserFailure(code: BrowserFailure, diagnostic: BrowserDiagnostic): ApnError {
  const failure = classifiedBrowserFailure(code);
  return new ApnError(failure.code, failure.message, { ...failure.details, consent_step: diagnostic.step,
    consent_permission_requested: diagnostic.permission_requested,
    ...(diagnostic.provider_code === null ? {} : { provider_error_code: diagnostic.provider_code }),
    ...(diagnostic.provider_message === null ? {} : { provider_error_message: diagnostic.provider_message }) });
}

function classifiedBrowserFailure(code: BrowserFailure): ApnError {
  if (code === "user_rejected") return new ApnError("APN_PROVIDER_SESSION_REQUIRED", "MetaMask permission consent was rejected; retry the same connect intent if desired.", { retryable: true });
  if (code === "missing_provider") return new ApnError("APN_PROVIDER_UNAVAILABLE", "No injected MetaMask provider was available in the foreground browser.", { retryable: true });
  if (code === "inactive_account") return smartAccountInactive();
  if (code === "unsupported_permission") return new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The selected MetaMask account does not support Base ERC-7715 allowance permissions.", { retryable: false });
  if (code === "changed_account") return new ApnError("APN_PROFILE_DRIFT", "The selected MetaMask account changed during foreground consent.", { retryable: false });
  if (code === "wrong_chain") return new ApnError("APN_CHAIN_MISMATCH", "MetaMask did not remain on Base chain 8453.", { retryable: true });
  return new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask returned an unsupported foreground consent result.", { retryable: false });
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new ApnError("APN_INTERNAL", "MetaMask loopback listener did not bind safely.");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function defaultOpenBrowser(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/open", [url], { shell: false, stdio: "ignore" });
    child.once("error", () => reject(new ApnError("APN_PROVIDER_UNAVAILABLE", "The foreground browser could not be opened.", { retryable: true })));
    child.once("close", (code) => code === 0 ? resolve() : reject(new ApnError("APN_PROVIDER_UNAVAILABLE", "The foreground browser could not be opened.", { retryable: true })));
  });
}
