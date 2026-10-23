/**
 * QA 0.5.70 SMART-CONNECT-INACTIVE-NEXT-ACTION-070-001: `wallet connect` to a MetaMask account whose official Base Smart
 * Account is not enabled yet refused correctly ("Enable the official MetaMask Smart Account on Base, then retry the same
 * connect intent.") but its next action said "Use a local profile for payment effects", i.e. change custody. Both the
 * browser consent and the grant preflight now name that setup step and the same intent; a genuinely unsupported
 * permission keeps its own answer. The refusals themselves are unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { failureEnvelope } from "../../src/output.js";
import { LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import { assertSmartAccountPreflight } from "../../src/metamask-smart-account-grant.js";
import type { Address } from "../../src/model.js";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const REQUEST = { sessionAddress: "0x2222222222222222222222222222222222222222" as Address, capAtomic: "2000000",
  startsAtUnix: 1_788_393_600, expiresAtUnix: 1_788_397_200 };
const ENABLE = "Enable the official MetaMask Smart Account on Base in MetaMask, then rerun the same `apn wallet connect` with the same " +
  "profile, provider, permission cap, expiry and idempotency key.";

function caught(run: () => unknown): Error & { code: string; details: Record<string, unknown> } {
  try { run(); } catch (error) { return error as Error & { code: string; details: Record<string, unknown> }; }
  assert.fail("no refusal");
}

async function browserOutcome(code: string) {
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    const opened = new URL(openedUrl);
    const callback = await fetch(`${opened.origin}/callback`, { method: "POST", headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: opened.hash.slice(1), outcome: { ok: false, code } }) });
    assert.equal(callback.status, 204);
  }, 1_000);
  try { await consent.request(REQUEST); } catch (error) { return error as Error & { code: string; details: Record<string, unknown> }; }
  assert.fail("the consent was accepted");
}

test("an inactive Smart Account in the grant preflight points at enabling it and the same intent, never another custody", () => {
  const refused = caught(() => assertSmartAccountPreflight({ owner_address: OWNER, chain_id: "0x2105", account_code: "0x",
    supported_permissions: {}, permission_responses: [] }));
  assert.equal(refused.code, "APN_PROVIDER_EFFECT_UNAVAILABLE");
  assert.deepEqual([refused.details.reason, refused.details.retryable], ["smart_account_inactive", true]);
  assert.deepEqual(failureEnvelope("wallet.connect", "request", refused, true).next_actions, [ENABLE]);
});

test("the browser consent's inactive account answers the same; an unsupported permission keeps its own advice", async () => {
  const inactive = await browserOutcome("inactive_account");
  assert.deepEqual([inactive.code, inactive.details.reason, inactive.details.retryable], ["APN_PROVIDER_EFFECT_UNAVAILABLE", "smart_account_inactive", true]);
  assert.deepEqual(failureEnvelope("wallet.connect", "request", inactive, true).next_actions, [ENABLE]);
  const unsupported = await browserOutcome("unsupported_permission");
  assert.deepEqual([unsupported.code, unsupported.details.retryable, unsupported.details.reason], ["APN_PROVIDER_EFFECT_UNAVAILABLE", false, undefined]);
  assert.deepEqual(failureEnvelope("wallet.connect", "request", unsupported, true).next_actions, ["Use a local profile for payment effects in this APN version."]);
  const wrongChain = await browserOutcome("wrong_chain");
  assert.equal(wrongChain.code, "APN_CHAIN_MISMATCH");
});
