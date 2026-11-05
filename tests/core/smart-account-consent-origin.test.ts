/**
 * Regression (QA 2026-11-04, 0.5.90): MetaMask keeps an Advanced Permission for the exact origin that requested it and
 * lists it only to that origin (snap-7715-permissions filters `permission.siteOrigin === siteOrigin`). APN served every
 * consent page on a fresh random loopback port, so `wallet permission sync` asked from another origin, saw an empty list
 * and would have recorded a live grant as `revoked` / `confirmed_absent`. A permission now keeps one consent port: saved
 * before its first consent, reused by every retry and sync; one recorded without it is never concluded present or absent.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { MetaMaskSmartAccountAdapter } from "../../src/metamask-smart-account-adapter.js";
import {
  allocateConsentPort,
  LoopbackMetaMaskConsent,
  type SmartAccountConsentPort,
  type SmartAccountConsentRequest,
  type SmartAccountConsentSync,
} from "../../src/metamask-smart-account-consent.js";
import type { SmartAccountPermissionStorePort } from "../../src/encrypted-smart-account-permission-store.js";
import {
  validateSmartAccountPermissionRecord,
  type GrantedSmartAccountPermissionRecord,
  type SmartAccountPermissionRecord,
} from "../../src/metamask-smart-account-record.js";
import type { Address, Hex } from "../../src/model.js";

const PROFILE = "smart-origin";
const PROFILE_HASH = sha256(`profile\0${PROFILE}`);
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const SESSION = { address: "0x2222222222222222222222222222222222222222" as Address, privateKey: `0x${"ab".repeat(32)}` as Hex };

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

class RecordingConsent implements SmartAccountConsentPort {
  readonly requests: SmartAccountConsentRequest[] = [];
  readonly syncs: SmartAccountConsentSync[] = [];
  async request(input: SmartAccountConsentRequest): Promise<unknown> {
    this.requests.push(input);
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "MetaMask foreground consent timed out safely; retry the same connect intent.", { retryable: true });
  }
  async sync(input: SmartAccountConsentSync): Promise<unknown> {
    this.syncs.push(input);
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "fixture stop", { retryable: true });
  }
}

function fixture() {
  const store = new MemoryStore(), consent = new RecordingConsent();
  const adapter = new MetaMaskSmartAccountAdapter(store, consent, { create: () => SESSION });
  const intent = { profile: PROFILE, profileHash: PROFILE_HASH, authenticationMethod: "browser" as const, idempotencyKey: "smart-origin-0001",
    capAtomic: "2000", expiresAtUnix: Math.floor(Date.now() / 1000) + 3600 };
  return { store, consent, adapter, intent };
}

function granted(pending: SmartAccountPermissionRecord): GrantedSmartAccountPermissionRecord {
  return { ...pending, phase: "active", owner_address: OWNER, granted_cap_atomic: "2000", granted_expires_at_unix: pending.requested_expires_at_unix,
    grant_context: "0x00", grant_fingerprint: "c".repeat(64), delegation_manager: "0x3333333333333333333333333333333333333333",
    permission_response: {} };
}

test("a permission keeps the consent port it saved before its first consent, through retries and sync", async () => {
  const { store, consent, adapter, intent } = fixture();
  await assert.rejects(adapter.connect(intent), { code: "APN_PROVIDER_UNAVAILABLE" });
  const port = store.record?.consent_port;
  assert.equal(typeof port, "number");
  assert.equal(consent.requests[0]?.port, port);
  await assert.rejects(adapter.connect(intent), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.deepEqual([consent.requests[1]?.port, store.record?.consent_port], [port, port]);
  store.record = granted(store.record!);
  await assert.rejects(adapter.sync(PROFILE_HASH, 1), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.deepEqual(consent.syncs, [{ port, ownerAddress: OWNER }]);
});

test("a pending intent saved before 0.5.91 gets its consent port before MetaMask is asked", async () => {
  const { store, consent, adapter, intent } = fixture();
  await assert.rejects(adapter.connect(intent), { code: "APN_PROVIDER_UNAVAILABLE" });
  const { consent_port: _old, ...legacy } = store.record!;
  store.record = legacy as SmartAccountPermissionRecord;
  await assert.rejects(adapter.connect(intent), { code: "APN_PROVIDER_UNAVAILABLE" });
  const port = store.record?.consent_port;
  assert.equal(typeof port, "number");
  assert.equal(consent.requests[1]?.port, port);
});

test("sync of a permission whose consent origin was never recorded refuses without touching it", async () => {
  const { store, consent, adapter, intent } = fixture();
  await assert.rejects(adapter.connect(intent), { code: "APN_PROVIDER_UNAVAILABLE" });
  const { consent_port: _old, ...legacy } = granted(store.record!);
  store.record = legacy as SmartAccountPermissionRecord;
  const before = canonicalJson(store.record);
  await assert.rejects(adapter.sync(PROFILE_HASH, 1), (error: ApnError) => error.code === "APN_PROVIDER_EFFECT_UNAVAILABLE" &&
    error.details?.reason === "consent_origin_unrecorded" && error.details.retryable === false &&
    Array.isArray(error.details.nextActions) && error.details.nextActions.length === 2 &&
    /permission list --profile smart-origin shows/u.test(String(error.details.nextActions[1])) &&
    !/--expected-revision \d/u.test(String(error.details.nextActions[1])));
  assert.deepEqual([consent.syncs.length, canonicalJson(store.record)], [0, before]);
});

test("the consent page binds exactly the saved port and refuses a busy one before opening the browser", async () => {
  const port = await allocateConsentPort();
  let opened = "";
  const consent = new LoopbackMetaMaskConsent(async (url) => {
    opened = url;
    const callback = await fetch(`${new URL(url).origin}/callback`, { method: "POST", headers: { "content-type": "application/json",
      origin: new URL(url).origin }, body: JSON.stringify({ token: new URL(url).hash.slice(1), outcome: { ok: true, value: { bound: true } } }) });
    assert.equal(callback.status, 204);
  }, 1_000);
  const request = { port, sessionAddress: SESSION.address, capAtomic: "2000", startsAtUnix: 1_788_393_600, expiresAtUnix: 1_788_397_200 };
  assert.deepEqual(await consent.request(request), { bound: true });
  assert.equal(new URL(opened).port, String(port));
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/app.js`).catch(() => null))?.status) ?? null, null, "the page is closed after use");
  const squatter = createServer();
  await new Promise<void>((resolve) => squatter.listen(port, "127.0.0.1", resolve));
  try {
    let launched = false;
    const busy = new LoopbackMetaMaskConsent(async () => { launched = true; }, 1_000);
    await assert.rejects(busy.sync({ port, ownerAddress: OWNER }), (error: ApnError) => error.code === "APN_PROVIDER_UNAVAILABLE" &&
      error.details?.reason === "consent_port_in_use" && error.details.consent_port === port && error.details.retryable === true &&
      Array.isArray(error.details.nextActions) && String(error.details.nextActions[0]).includes(`lsof -nP -iTCP:${port} -sTCP:LISTEN`));
    assert.equal(launched, false);
  } finally { await new Promise<void>((resolve) => squatter.close(() => resolve())); }
});

test("a record's consent port must be a whole unprivileged port", () => {
  const { intent } = fixture();
  const base = { schema_version: "apn.metamask-smart-account-permission.v1", profile: PROFILE, profile_hash: PROFILE_HASH,
    provider_id: "metamask-smart-account", idempotency_hash: "a".repeat(64), intent_fingerprint: "b".repeat(64), phase: "pending_consent",
    revision: 1, requested_cap_atomic: "2000", requested_expires_at_unix: intent.expiresAtUnix, starts_at_unix: intent.expiresAtUnix - 3600,
    session_address: SESSION.address, session_private_key: SESSION.privateKey, created_at: "2026-11-05T00:00:00.000Z",
    updated_at: "2026-11-05T00:00:00.000Z", max_observed_unix: intent.expiresAtUnix - 3600, revocation_freshness: "never_synced" };
  assert.equal(validateSmartAccountPermissionRecord({ ...base, consent_port: 43123 }).consent_port, 43123);
  assert.equal(validateSmartAccountPermissionRecord(base).consent_port, undefined);
  for (const consent_port of [80, 65536, 1.5, "43123", null]) {
    assert.throws(() => validateSmartAccountPermissionRecord({ ...base, consent_port }), JSON.stringify(consent_port));
  }
});
