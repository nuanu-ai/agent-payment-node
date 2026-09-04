import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { BASE_CHAIN_HEX, smartAccountEnvironment } from "./metamask-smart-account-grant.js";
const CALLBACK_PATH = "/callback";
const MAX_BODY_BYTES = 256 * 1024;
const DEADLINE_MS = 5 * 60_000;
export class LoopbackMetaMaskConsent {
    openBrowser;
    deadlineMs;
    constructor(openBrowser = defaultOpenBrowser, deadlineMs = DEADLINE_MS) {
        this.openBrowser = openBrowser;
        this.deadlineMs = deadlineMs;
        if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > DEADLINE_MS) {
            throw new ApnError("APN_INTERNAL", "MetaMask consent deadline is invalid.");
        }
    }
    async request(input) {
        return await this.run({ mode: "request", ...input });
    }
    async sync(input) {
        return await this.run({ mode: "sync", ...input });
    }
    async run(config) {
        const token = randomBytes(32).toString("hex");
        let used = false;
        let settle;
        let fail;
        const terminal = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
        const server = createServer((request, response) => {
            void this.handle(request, response, config, token, () => used, () => { used = true; }, settle, fail);
        });
        const port = await listen(server);
        const origin = `http://127.0.0.1:${port}`;
        const timer = setTimeout(() => fail?.(new ApnError("APN_PROVIDER_UNAVAILABLE", "MetaMask foreground consent timed out safely; retry the same connect intent.", { retryable: true })), this.deadlineMs);
        try {
            void this.openBrowser(`${origin}/#${token}`).catch(() => fail?.(new ApnError("APN_PROVIDER_UNAVAILABLE", "The foreground browser could not be opened.", { retryable: true })));
            return await terminal;
        }
        finally {
            clearTimeout(timer);
            await closeServer(server);
        }
    }
    async handle(request, response, config, token, isUsed, consume, resolve, reject) {
        try {
            const port = request.socket.address().port;
            const host = `127.0.0.1:${port}`;
            if (request.headers.host !== host || request.url === undefined || request.url.includes("?"))
                return rejectHttp(response, reject);
            if (request.method === "GET" && request.url === "/")
                return serve(response, "text/html; charset=utf-8", PAGE);
            if (request.method === "GET" && request.url === "/app.js") {
                return serve(response, "text/javascript; charset=utf-8", browserScript(config));
            }
            if (request.method !== "POST" || request.url !== CALLBACK_PATH || isUsed() ||
                request.headers.origin !== `http://${host}` || request.headers["content-type"] !== "application/json") {
                return rejectHttp(response, reject);
            }
            consume();
            const body = await readBody(request);
            const parsed = JSON.parse(body);
            if (!isCallback(parsed) || parsed.token !== token)
                return rejectHttp(response, reject);
            response.writeHead(204, securityHeaders());
            response.end();
            if (parsed.outcome.ok)
                resolve(parsed.outcome.value);
            else
                reject(browserFailure(parsed.outcome.code));
        }
        catch {
            rejectHttp(response, reject);
        }
    }
}
function isCallback(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["token", "outcome"]))
        return false;
    const record = value;
    if (typeof record.token !== "string" || !/^[a-f0-9]{64}$/u.test(record.token) || !isPlainRecord(record.outcome))
        return false;
    const outcome = record.outcome;
    return outcome.ok === true
        ? exactKeys(outcome, ["ok", "value"])
        : outcome.ok === false && exactKeys(outcome, ["ok", "code"]) && [
            "missing_provider", "user_rejected", "wrong_chain", "unsupported_permission",
            "inactive_account", "changed_account", "provider_protocol",
        ].includes(String(outcome.code));
}
function browserScript(config) {
    const environment = smartAccountEnvironment();
    const publicConfig = {
        ...config,
        chainId: BASE_CHAIN_HEX,
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        implementation: environment.implementations.EIP7702StatelessDeleGatorImpl,
        callback: CALLBACK_PATH,
    };
    return `"use strict";\nconst config=${JSON.stringify(publicConfig)};\n${BROWSER_LOGIC}`;
}
const BROWSER_LOGIC = String.raw `
const token = location.hash.slice(1);
history.replaceState(null, "", "/");
const setStatus = (value) => { document.getElementById("status").textContent = value; };
const post = async (outcome) => {
  await fetch(config.callback, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, outcome }) });
  setStatus(outcome.ok ? "Permission accepted. You may close this tab." : "Permission stopped safely. You may close this tab.");
  setTimeout(() => window.close(), 250);
};
const classify = (error) => error && Number(error.code) === 4001 ? "user_rejected" : "provider_protocol";
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
const accountCode = async (provider, owner) => await provider.request({ method: "eth_getCode", params: [owner, "latest"] });
const active = (code) => typeof code === "string" && code.toLowerCase() === ("0xef0100" + config.implementation.slice(2)).toLowerCase();
const sameAccount = async (provider, owner) => {
  const accounts = await provider.request({ method: "eth_accounts", params: [] });
  return Array.isArray(accounts) && accounts.length > 0 && String(accounts[0]).toLowerCase() === owner.toLowerCase();
};
(async () => {
  try {
    const provider = await chooseProvider(await discoverProviders());
    if (!provider) return await post({ ok: false, code: "missing_provider" });
    const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
    if (!Array.isArray(accounts) || accounts.length === 0) return await post({ ok: false, code: "provider_protocol" });
    const owner = String(accounts[0]);
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: config.chainId }] }); }
    catch (error) {
      if (Number(error && error.code) !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: config.chainId, chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }] });
    }
    const chainId = await provider.request({ method: "eth_chainId", params: [] });
    if (String(chainId).toLowerCase() !== config.chainId) return await post({ ok: false, code: "wrong_chain" });
    if (!(await sameAccount(provider, owner))) return await post({ ok: false, code: "changed_account" });
    const supported = await provider.request({ method: "wallet_getSupportedExecutionPermissions", params: [] });
    const allowance = supported && supported["erc20-token-allowance"];
    if (!allowance || (allowance.chainIds !== undefined && (!Array.isArray(allowance.chainIds) || !allowance.chainIds.some((item) => String(item).toLowerCase() === config.chainId))) || !Array.isArray(allowance.ruleTypes) || !allowance.ruleTypes.includes("expiry")) {
      return await post({ ok: false, code: "unsupported_permission" });
    }
    const code = await accountCode(provider, owner);
    if (!active(code)) return await post({ ok: false, code: "inactive_account" });
    if (config.mode === "sync") {
      if (owner.toLowerCase() !== config.ownerAddress.toLowerCase()) return await post({ ok: false, code: "changed_account" });
      const permission_responses = await provider.request({ method: "wallet_getGrantedExecutionPermissions", params: [] });
      return await post({ ok: true, value: { owner_address: owner, chain_id: chainId, account_code: code, supported_permissions: supported, permission_responses } });
    }
    const request = { chainId: config.chainId, from: owner, to: config.sessionAddress, permission: { type: "erc20-token-allowance", isAdjustmentAllowed: true, data: { tokenAddress: config.tokenAddress, allowanceAmount: "0x" + BigInt(config.capAtomic).toString(16), startTime: config.startsAtUnix, justification: "Allow this APN session to spend up to the selected Base USDC cap." } }, rules: [{ type: "expiry", data: { timestamp: config.expiresAtUnix } }] };
    if (!(await sameAccount(provider, owner)) || !active(await accountCode(provider, owner))) return await post({ ok: false, code: "changed_account" });
    const permission_responses = await provider.request({ method: "wallet_requestExecutionPermissions", params: [request] });
    const finalChain = await provider.request({ method: "eth_chainId", params: [] });
    const finalCode = await accountCode(provider, owner);
    if (String(finalChain).toLowerCase() !== config.chainId || !(await sameAccount(provider, owner)) || !active(finalCode)) return await post({ ok: false, code: "changed_account" });
    return await post({ ok: true, value: { owner_address: owner, chain_id: finalChain, account_code: finalCode, supported_permissions: supported, permission_responses } });
  } catch (error) { await post({ ok: false, code: classify(error) }); }
})();`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APN MetaMask permission</title></head><body><main><h1>APN MetaMask Smart Account</h1><p id="status">Finding injected wallet providers…</p><p>Provider identity metadata is self-reported and unverified. Choose the wallet you installed and intend to use. Provider icons are not displayed.</p><ol id="providers" aria-label="Injected wallet providers"></ol></main><script src="/app.js"></script></body></html>`;
function securityHeaders() {
    return {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
    };
}
function serve(response, type, body) {
    response.writeHead(200, { ...securityHeaders(), "content-type": type });
    response.end(body);
}
async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const value of request) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
            throw new Error("body limit");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
function rejectHttp(response, reject) {
    if (!response.headersSent)
        response.writeHead(400, securityHeaders());
    response.end();
    reject(new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask loopback consent violated its bounded protocol.", { retryable: false }));
}
function browserFailure(code) {
    if (code === "user_rejected")
        return new ApnError("APN_PROVIDER_SESSION_REQUIRED", "MetaMask permission consent was rejected; retry the same connect intent if desired.", { retryable: true });
    if (code === "missing_provider")
        return new ApnError("APN_PROVIDER_UNAVAILABLE", "No injected MetaMask provider was available in the foreground browser.", { retryable: true });
    if (code === "inactive_account")
        return new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "Enable the official MetaMask Smart Account on Base, then retry the same connect intent.", { retryable: true });
    if (code === "unsupported_permission")
        return new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The selected MetaMask account does not support Base ERC-7715 allowance permissions.", { retryable: false });
    if (code === "changed_account")
        return new ApnError("APN_PROFILE_DRIFT", "The selected MetaMask account changed during foreground consent.", { retryable: false });
    if (code === "wrong_chain")
        return new ApnError("APN_CHAIN_MISMATCH", "MetaMask did not remain on Base chain 8453.", { retryable: true });
    return new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask returned an unsupported foreground consent result.", { retryable: false });
}
async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address();
    if (address === null || typeof address === "string")
        throw new ApnError("APN_INTERNAL", "MetaMask loopback listener did not bind safely.");
    return address.port;
}
async function closeServer(server) {
    server.closeAllConnections();
    if (!server.listening)
        return;
    await new Promise((resolve) => server.close(() => resolve()));
}
async function defaultOpenBrowser(url) {
    await new Promise((resolve, reject) => {
        const child = spawn("/usr/bin/open", [url], { shell: false, stdio: "ignore" });
        child.once("error", () => reject(new ApnError("APN_PROVIDER_UNAVAILABLE", "The foreground browser could not be opened.", { retryable: true })));
        child.once("close", (code) => code === 0 ? resolve() : reject(new ApnError("APN_PROVIDER_UNAVAILABLE", "The foreground browser could not be opened.", { retryable: true })));
    });
}
//# sourceMappingURL=metamask-smart-account-consent.js.map