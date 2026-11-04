/**
 * Regression (QA 2026-11-04, 0.5.89): a live `wallet connect --provider metamask-smart-account` ended with
 * "MetaMask returned an unsupported foreground consent result" and nothing said which wallet call failed or how. The
 * consent page now reports its last step and, when a wallet call threw, the wallet's numeric code and printable message;
 * the CLI keeps them in `error.details` and refuses a callback whose diagnostic is not in that exact shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { failureEnvelope } from "../../src/output.js";
import { LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import type { Address } from "../../src/model.js";

const REQUEST = { sessionAddress: "0x2222222222222222222222222222222222222222" as Address, capAtomic: "2000",
  startsAtUnix: 1_788_393_600, expiresAtUnix: 1_788_397_200 };
type Refusal = Error & { code: string; details: Record<string, unknown> };

async function posted(outcome: unknown): Promise<{ status: number; error: Refusal }> {
  let callback: Promise<number> | undefined;
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    const opened = new URL(openedUrl);
    callback = fetch(`${opened.origin}/callback`, { method: "POST", headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: opened.hash.slice(1), outcome }) }).then((response) => response.status);
    await callback;
  }, 1_000);
  try { await consent.request(REQUEST); } catch (error) {
    if (callback === undefined) assert.fail("the callback was never posted");
    return { status: await callback, error: error as Refusal };
  }
  assert.fail("the consent was accepted");
}

test("a thrown wallet call reaches the CLI as its step, code and message", async () => {
  const { status, error } = await posted({ ok: false, code: "provider_protocol", diagnostic: {
    step: "wallet_requestExecutionPermissions", provider_code: -32603, provider_message: "Internal JSON-RPC error." } });
  assert.equal(status, 204);
  assert.equal(error.code, "APN_PROVIDER_PROTOCOL");
  assert.equal(error.message, "MetaMask returned an unsupported foreground consent result.");
  const envelope = failureEnvelope("wallet.connect", "request", error, true);
  assert.deepEqual(envelope.error?.details, { retryable: false, consent_step: "wallet_requestExecutionPermissions",
    provider_error_code: -32603, provider_error_message: "Internal JSON-RPC error." });
});

test("a refusal no wallet call threw keeps its own answer and adds only the step", async () => {
  const { error } = await posted({ ok: false, code: "user_rejected", diagnostic: {
    step: "wallet_requestExecutionPermissions", provider_code: 4001, provider_message: "User rejected the request." } });
  assert.equal(error.code, "APN_PROVIDER_SESSION_REQUIRED");
  assert.deepEqual(error.details, { retryable: true, consent_step: "wallet_requestExecutionPermissions", provider_error_code: 4001,
    provider_error_message: "User rejected the request." });
  const missing = await posted({ ok: false, code: "missing_provider", diagnostic: { step: "provider_choice", provider_code: null, provider_message: null } });
  assert.equal(missing.error.code, "APN_PROVIDER_UNAVAILABLE");
  assert.deepEqual(missing.error.details, { retryable: true, consent_step: "provider_choice" });
});

test("a failure callback without the exact diagnostic is a protocol violation", async () => {
  const diagnostic = { step: "eth_chainId", provider_code: null, provider_message: null };
  const malformed: unknown[] = [
    { ok: false, code: "provider_protocol" },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, step: "eth_sendTransaction" } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: 1.5 } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: "4001" } },
    { ok: false, code: "provider_protocol", diagnostic: { ...diagnostic, provider_code: 2 ** 40 } },
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
