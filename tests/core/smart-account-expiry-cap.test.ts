/**
 * QA case APN-SMART-PERM-CONNECT-INVALID: `--permission-expires-at` in Unix milliseconds reached MetaMask consent as a
 * date far in the future, because APN had no upper bound. The owner set the bound on 2026-11-23: a Smart Account
 * permission expires at most 24 hours after the connect. A later expiry, milliseconds included, is refused before
 * anything is saved and before MetaMask is asked. A pending intent that 0.5.110 or earlier saved with a longer
 * window is not sent to MetaMask either; its next actions cancel it locally.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import * as cliRuntime from "../../src/cli.js";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import type { SmartAccountPermissionStorePort } from "../../src/encrypted-smart-account-permission-store.js";
import * as errorRuntime from "../../src/errors.js";
import { ApnError } from "../../src/errors.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { METAMASK_SMART_ACCOUNT_PROVIDER_ID, MetaMaskSmartAccountAdapter } from "../../src/metamask-smart-account-adapter.js";
import type { SmartAccountConsentPort, SmartAccountConsentRequest } from "../../src/metamask-smart-account-consent.js";
import {
  projectPendingPermissionBinding,
  validateSmartAccountPermissionRecord,
  type PendingSmartAccountPermissionRecord,
  type SmartAccountPermissionRecord,
} from "../../src/metamask-smart-account-record.js";
import type { Address, Hex } from "../../src/model.js";
import { pendingPermissionNextActions } from "../../src/provider-permission-output.js";
import { SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS } from "../../src/smart-account-permission-lifetime.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { ApnError: RuntimeApnError } = await testRuntime(errorRuntime, "errors.js");
const SESSION_KEY = `0x${"2".repeat(64)}` as Hex, SESSION = privateKeyToAccount(SESSION_KEY).address as Address;
const NOW = 1_788_393_600, PROFILE = "smart-account", KEY = "smart-account-connect-0001";
const connect = (expiry: number, key = KEY) => ["wallet", "connect", "--profile", PROFILE, "--provider", METAMASK_SMART_ACCOUNT_PROVIDER_ID,
  "--auth-method", "browser", "--permission-cap-usdc-atomic", "2000000", "--permission-expires-at", String(expiry), "--idempotency-key", key];

class Wrapping implements WrappingSecretPort {
  async load(): Promise<Buffer | null> { return Buffer.from("33".repeat(32), "hex"); }
  async create(): Promise<Buffer> { return Buffer.from("33".repeat(32), "hex"); }
}
/** MetaMask consent that times out, which leaves the intent pending; it keeps every request. */
class TimingOutConsent implements SmartAccountConsentPort {
  readonly requests: SmartAccountConsentRequest[] = [];
  constructor(private readonly error: typeof ApnError) {}
  async request(input: SmartAccountConsentRequest): Promise<unknown> {
    this.requests.push(input);
    throw new this.error("APN_PROVIDER_UNAVAILABLE", "MetaMask foreground consent timed out safely; retry the same connect intent.", { retryable: true });
  }
  async sync(): Promise<unknown> { throw new Error("no sync expected"); }
}

async function cli(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const consent = new TimingOutConsent(RuntimeApnError as typeof ApnError);
  const options = { stateRoot: temporary.root, wrappingSecret: new Wrapping(), smartAccountConsent: consent,
    smartAccountSessionKeys: { create: () => ({ address: SESSION, privateKey: SESSION_KEY }) }, clock: { now: () => new Date(NOW * 1000) } };
  return { consent, run: (argv: readonly string[]) => runCli([...argv], {}, options as never) };
}

test("an expiry exactly 24 hours from now reaches MetaMask consent", async (t) => {
  const { consent, run } = await cli(t);
  const answer = await run(connect(NOW + SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS));
  assert.equal(answer.error?.code, "APN_PROVIDER_UNAVAILABLE", JSON.stringify(answer));
  assert.deepEqual(consent.requests.map((request) => [request.startsAtUnix, request.expiresAtUnix]), [[NOW, NOW + 86_400]]);
});

test("an expiry one second past 24 hours, or in milliseconds, is refused before anything is saved or asked", async (t) => {
  const { consent, run } = await cli(t);
  for (const expiry of [NOW + 86_401, (NOW + 3_600) * 1000]) {
    const refused = await run(connect(expiry));
    assert.deepEqual([refused.error?.code, refused.error?.details?.reason, refused.error?.details?.latest_expires_at_unix],
      ["APN_INVALID_INPUT", "permission_expiry_beyond_cap", String(NOW + 86_400)], JSON.stringify(refused));
    assert.deepEqual(refused.next_actions,
      ["Run the same wallet connect again with a --permission-expires-at in Unix seconds no later than latest_expires_at_unix."]);
    assert.equal(refused.error?.message,
      `Permission expiry must be Unix seconds at most 24 hours from now: no later than ${NOW + 86_400} (${new Date((NOW + 86_400) * 1000).toISOString()}).`);
  }
  assert.equal(consent.requests.length, 0, "MetaMask is never asked");
  // Nothing was saved: the same idempotency key with a valid expiry is a new intent, not a conflict.
  const valid = await run(connect(NOW + 3_600));
  assert.equal(valid.error?.code, "APN_PROVIDER_UNAVAILABLE", JSON.stringify(valid));
  assert.deepEqual(consent.requests.map((request) => request.expiresAtUnix), [NOW + 3_600]);
});

class MemoryStore implements SmartAccountPermissionStorePort {
  record: SmartAccountPermissionRecord | null = null;
  async load(): Promise<SmartAccountPermissionRecord | null> {
    return this.record === null ? null : validateSmartAccountPermissionRecord(structuredClone(this.record));
  }
  async save(record: SmartAccountPermissionRecord): Promise<void> { this.record = validateSmartAccountPermissionRecord(structuredClone(record)); }
  async remove(): Promise<void> { this.record = null; }
  async compareAndSet(expected: SmartAccountPermissionRecord, replacement: SmartAccountPermissionRecord | null): Promise<boolean> {
    if (this.record === null || canonicalJson(this.record) !== canonicalJson(expected)) return false;
    if (replacement === null) this.record = null; else await this.save(replacement);
    return true;
  }
}

test("a pending intent that 0.5.110 saved with a 30-day window is not sent to MetaMask and names forget", async () => {
  const store = new MemoryStore(), consent = new TimingOutConsent(ApnError);
  const adapter = new MetaMaskSmartAccountAdapter(store, consent, { create: () => ({ address: SESSION, privateKey: SESSION_KEY }) },
    () => new Date(NOW * 1000));
  const profileHash = sha256(`profile\0${PROFILE}`), idempotencyHash = sha256(`idempotency\0${KEY}`);
  const expiresAtUnix = NOW - 60 + 30 * 86_400;
  const intent = { profile: PROFILE, profileHash, authenticationMethod: "browser" as const, idempotencyKey: KEY, capAtomic: "2000000", expiresAtUnix };
  // The intent fingerprint as 0.5.110 wrote it for this intent.
  const fingerprint = hashObject({ profile: PROFILE, provider: METAMASK_SMART_ACCOUNT_PROVIDER_ID, authentication_method: "browser",
    chain: "eip155:8453", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", requested_cap_atomic: "2000000",
    requested_expires_at_unix: expiresAtUnix, idempotency_hash: idempotencyHash });
  await store.save({ schema_version: "apn.metamask-smart-account-permission.v1", profile: PROFILE, profile_hash: profileHash,
    provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID, idempotency_hash: idempotencyHash, intent_fingerprint: fingerprint, phase: "pending_consent",
    revision: 1, requested_cap_atomic: "2000000", requested_expires_at_unix: expiresAtUnix, starts_at_unix: NOW - 60, session_address: SESSION,
    session_private_key: SESSION_KEY, created_at: new Date((NOW - 60) * 1000).toISOString(), updated_at: new Date((NOW - 60) * 1000).toISOString(),
    max_observed_unix: NOW - 60, revocation_freshness: "never_synced", consent_port: 43_123 } as SmartAccountPermissionRecord);
  const before = canonicalJson(store.record);
  const capActions = [
    `In MetaMask, check whether a permission for session ${SESSION} was granted, and revoke it there if it is not wanted.`,
    `Then cancel only the local pending intent with apn wallet permission forget --profile ${PROFILE} --expected-revision 1.`,
    "Start a new wallet connect with an expiry at most 24 hours from now and a new idempotency key.",
  ];
  await assert.rejects(adapter.connect(intent), (error: ApnError) => {
    assert.deepEqual([error.code, error.details?.reason], ["APN_INVALID_INPUT", "permission_expiry_beyond_cap"]);
    assert.deepEqual(error.details?.nextActions, capActions);
    return true;
  });
  // list, status, sync and disable advise the same while the intent is live, never the exact retry; once expired, the expired guidance.
  const binding = projectPendingPermissionBinding(store.record as PendingSmartAccountPermissionRecord);
  assert.deepEqual(pendingPermissionNextActions(PROFILE, binding, NOW), capActions);
  assert.match(pendingPermissionNextActions(PROFILE, binding, expiresAtUnix)[0]!, /^The intent expired at /u);
  assert.equal(consent.requests.length, 0, "MetaMask is never asked");
  assert.equal(canonicalJson(store.record), before, "the pending intent is left as it was");
});
