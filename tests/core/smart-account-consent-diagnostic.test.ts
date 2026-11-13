/**
 * Regression (QA 2026-11-04, 0.5.89): a live `wallet connect --provider metamask-smart-account` ended with
 * "MetaMask returned an unsupported foreground consent result" and nothing said which wallet call failed or how. The
 * consent page now reports its last step, whether MetaMask had already answered the permission request, and, when a
 * wallet call itself threw, the wallet's numeric code and printable message. The CLI keeps them in `error.details` and
 * refuses a callback whose diagnostic is not in that exact shape. Every outcome the served page posts is fed back into
 * the real loopback server, so the page and the server's step list cannot drift apart.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { failureEnvelope } from "../../src/output.js";
import { allocateConsentPort, LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import { smartAccountEnvironment } from "../../src/metamask-smart-account-grant.js";
import { OWNER, REQUEST, runServedBrowser, waitFor, type BrowserProvider } from "./smart-account-browser-harness.js";

type Refusal = Error & { code: string; details: Record<string, unknown> };
const IMPLEMENTATION = smartAccountEnvironment().implementations.EIP7702StatelessDeleGatorImpl;
if (IMPLEMENTATION === undefined) throw new Error("the pinned EIP-7702 implementation is missing");
const ACTIVE = `0xef0100${IMPLEMENTATION.slice(2)}`;
const SUPPORTED = { "erc20-token-allowance": { chainIds: ["0x2105"], ruleTypes: ["expiry"] } };

async function posted(outcome: unknown): Promise<{ status: number; error: Refusal }> {
  let callback: Promise<number> | undefined;
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    const opened = new URL(openedUrl);
    callback = fetch(`${opened.origin}/callback`, { method: "POST", headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: opened.hash.slice(1), outcome }) }).then((response) => response.status);
    await callback;
  }, 1_000);
  try { await consent.request({ ...REQUEST, port: await allocateConsentPort() }); } catch (error) {
    if (callback === undefined) assert.fail("the callback was never posted");
    return { status: await callback, error: error as Refusal };
  }
  assert.fail("the consent was accepted");
}

/** Runs the served page against a scripted wallet, clicks its only provider and returns the outcome it posted. */
async function pageOutcome(answer: (method: string, call: number) => unknown, mode: "request" | "sync" = "request") {
  const counts = new Map<string, number>();
  const provider: BrowserProvider = { request: async (request) => {
    const method = (request as { method: string }).method, call = (counts.get(method) ?? 0) + 1;
    counts.set(method, call);
    return answer(method, call);
  } };
  const browser = await runServedBrowser({ ethereum: provider, mode });
  await waitFor(() => browser.document.buttons().length > 0, "provider choice");
  browser.document.buttons()[0]?.click();
  await waitFor(() => browser.posts.length > 0, "consent result");
  const outcome = (browser.posts[0] as { outcome: { diagnostic: Record<string, unknown> } }).outcome;
  const { status, error } = await posted(outcome);
  assert.equal(status, 204, `the server refused the page's own outcome ${JSON.stringify(outcome)}`);
  return { outcome, error, status: browser.document.status.textContent };
}

const healthy = (method: string): unknown => ({ eth_requestAccounts: [OWNER], eth_accounts: [OWNER], wallet_switchEthereumChain: null,
  eth_chainId: "0x2105", wallet_getSupportedExecutionPermissions: SUPPORTED, eth_getCode: ACTIVE, wallet_getGrantedExecutionPermissions: [], wallet_requestExecutionPermissions: [] } as Record<string, unknown>)[method];

test("the page names the wallet call that threw, with the wallet's code and printable message", async () => {
  const thrown = `The method "wallet_getSupportedExecutionPermissions" does not exist.\u0007‮\u{1F600}${"x".repeat(200)}`;
  const { outcome, error, status } = await pageOutcome((method) => {
    if (method === "wallet_getSupportedExecutionPermissions") throw Object.assign(new Error(thrown), { code: -32601 });
    return healthy(method);
  });
  const message = `The method "wallet_getSupportedExecutionPermissions" does not exist.???${"x".repeat(200)}`.slice(0, 160);
  assert.deepEqual(outcome, { ok: false, code: "provider_protocol", diagnostic: { step: "wallet_getSupportedExecutionPermissions",
    permission_requested: false, provider_code: -32601, provider_message: message } });
  assert.equal(status, "Permission stopped safely at wallet_getSupportedExecutionPermissions (wallet error -32601). You may close this tab.");
  assert.equal(error.code, "APN_PROVIDER_PROTOCOL");
  assert.deepEqual(failureEnvelope("wallet.connect", "request", error, true).error?.details, { retryable: false,
    consent_step: "wallet_getSupportedExecutionPermissions", consent_permission_requested: false, provider_error_code: -32601, provider_error_message: message });
});

test("a refused answer names the call it came from and carries no wallet error", async () => {
  const { outcome, error } = await pageOutcome((method) => method === "eth_chainId" ? "0x1" : healthy(method));
  assert.deepEqual(outcome.diagnostic, { step: "eth_chainId", permission_requested: false, provider_code: null, provider_message: null });
  assert.deepEqual([error.code, error.details.consent_step, "provider_error_code" in error.details], ["APN_CHAIN_MISMATCH", "eth_chainId", false]);
});

test("a check after the permission request says so and names the answer that failed", async () => {
  const chain = await pageOutcome((method, call) => method === "eth_chainId" && call === 2 ? "0x1" : healthy(method));
  assert.deepEqual(chain.outcome.diagnostic, { step: "eth_chainId", permission_requested: true, provider_code: null, provider_message: null });
  assert.deepEqual([chain.error.code, chain.error.details.consent_permission_requested], ["APN_PROFILE_DRIFT", true]);
  const code = await pageOutcome((method, call) => method === "eth_getCode" && call === 3 ? "0x" : healthy(method));
  assert.deepEqual(code.outcome.diagnostic, { step: "eth_getCode", permission_requested: true, provider_code: null, provider_message: null });
  const account = await pageOutcome((method, call) => method === "eth_accounts" && call === 3 ? ["0x3333333333333333333333333333333333333333"] : healthy(method));
  assert.deepEqual(account.outcome.diagnostic, { step: "eth_accounts", permission_requested: true, provider_code: null, provider_message: null });
  const before = await pageOutcome((method, call) => method === "eth_getCode" && call === 1 ? "0x" : healthy(method));
  assert.deepEqual([before.outcome.diagnostic.step, before.outcome.diagnostic.permission_requested], ["eth_getCode", false]);
});

test("a sync that selects another account stops at owner_match", async () => {
  const other = "0x4444444444444444444444444444444444444444";
  const { outcome, error } = await pageOutcome((method) => method === "eth_requestAccounts" || method === "eth_accounts" ? [other] : healthy(method), "sync");
  assert.deepEqual(outcome, { ok: false, code: "changed_account", diagnostic: { step: "owner_match", permission_requested: false, provider_code: null, provider_message: null } });
  assert.equal(error.code, "APN_PROFILE_DRIFT");
});

test("an error whose properties throw still ends the consent, and the page's own exception is not a wallet error", async () => {
  const hostile = await pageOutcome((method) => {
    if (method !== "eth_requestAccounts") return healthy(method);
    throw Object.defineProperties({}, { code: { get: () => { throw new Error("code"); } }, message: { get: () => { throw new Error("message"); } } });
  });
  assert.deepEqual(hostile.outcome, { ok: false, code: "provider_protocol", diagnostic: { step: "eth_requestAccounts", permission_requested: false,
    provider_code: null, provider_message: null } });
  const own = await pageOutcome((method) => method === "eth_requestAccounts"
    ? [{ toString: () => { throw Object.assign(new Error("page"), { code: 4001 }); } }] : healthy(method));
  assert.deepEqual(own.outcome, { ok: false, code: "provider_protocol", diagnostic: { step: "eth_requestAccounts", permission_requested: false,
    provider_code: null, provider_message: null } });
  const rejected = await pageOutcome((method) => {
    if (method === "wallet_requestExecutionPermissions") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    return healthy(method);
  });
  assert.deepEqual([rejected.error.code, rejected.error.details.provider_error_code, rejected.error.details.consent_permission_requested],
    ["APN_PROVIDER_SESSION_REQUIRED", 4001, true]);
  const lost = await pageOutcome((method) => {
    if (method === "wallet_requestExecutionPermissions") throw Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 });
    return healthy(method);
  });
  assert.deepEqual(lost.outcome.diagnostic, { step: "wallet_requestExecutionPermissions", permission_requested: true, provider_code: -32603,
    provider_message: "Internal JSON-RPC error." });
});

test("a failure callback without the exact diagnostic is a protocol violation", async () => {
  const diagnostic = { step: "eth_chainId", permission_requested: false, provider_code: null, provider_message: null };
  for (const boundary of [2 ** 31, -(2 ** 31)]) {
    assert.equal((await posted({ ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: boundary } })).status, 204);
  }
  const malformed: unknown[] = [
    { ok: false, code: "provider_protocol" },
    { ok: false, code: "provider_protocol", diagnostic: { step: "eth_chainId", provider_code: null, provider_message: null } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, permission_requested: "false" } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, step: "eth_sendTransaction" } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: 1.5 } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: "4001" } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: 2 ** 31 + 1 } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_message: "bell\u0007" } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_message: "x".repeat(161) } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, extra: true } },
    { ok: false, code: "unknown_code", diagnostic },
  ];
  for (const outcome of malformed) {
    const { status, error } = await posted(outcome);
    assert.equal(status, 400, JSON.stringify(outcome));
    assert.equal(error.code, "APN_PROVIDER_PROTOCOL");
    assert.equal(error.message, "MetaMask loopback consent violated its bounded protocol.");
  }
});
