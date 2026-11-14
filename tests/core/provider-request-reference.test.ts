/**
 * QA F26: the pending MFA request reference of MetaMask native and provider direct transfers is kept encrypted. The
 * store seals it with the shared custody envelope under the wrapping secret; an independent AES-GCM reader opens the
 * file, the sealed directories count for the wrapping-secret guard, and every open that cannot succeed refuses
 * precisely. Synthetic wrapping secret only; the Keychain is never touched.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { EncryptedProviderRequestReferenceStore, PROVIDER_REQUEST_REFERENCE_DIRECTORIES, providerRequestReferenceHash,
  type ProviderRequestReferenceBinding, type ProviderRequestReferenceLane } from "../../src/provider-request-reference-store.js";
import { StateStore } from "../../src/state.js";
import { holdsSealedCustody } from "../../src/wrapping-secret-custody.js";
import { FixedSecret, nestedFormat, referenceOpen } from "./custody-envelope-reference.js";
import { ReferenceTestSecret, flipped, rewrite } from "./provider-request-reference-helpers.js";

const REQUEST = "8cc50f3c-ca4e-41d1-98bb-b30f7bcaa3aa", PROVIDER = "metamask-agent-wallet";
const LANES: readonly ProviderRequestReferenceLane[] = ["metamask-native", "provider-direct"];
const sandbox = async () => await mkdtemp(join(await realpath(tmpdir()), "apn-provider-request-reference-"));
const bindingFor = (lane: ProviderRequestReferenceLane, operationId = "b".repeat(64), reference = REQUEST): ProviderRequestReferenceBinding =>
  ({ lane, providerId: PROVIDER, profileHash: "a".repeat(64), operationId, referenceHash: providerRequestReferenceHash(PROVIDER, reference) });
const sealedPath = (state: StateStore, binding: ProviderRequestReferenceBinding) =>
  join(state.root, PROVIDER_REQUEST_REFERENCE_DIRECTORIES[binding.lane], binding.profileHash, `${binding.operationId}.json`);
const refused = (code: string, reason?: string) => (error: unknown) =>
  error instanceof ApnError && error.code === code && (reason === undefined || error.details?.reason === reason);

test("the hash is the one direct transfers have always shown for a provider request", () => {
  // The formula of `provider_request_reference_hash` in every release up to 0.5.106, written out independently.
  assert.equal(providerRequestReferenceHash(PROVIDER, REQUEST),
    createHash("sha256").update(`provider-effect-reference\0${PROVIDER}\0${REQUEST}`).digest("hex"));
  assert.notEqual(providerRequestReferenceHash(PROVIDER, REQUEST), providerRequestReferenceHash("other-provider", REQUEST));
});

test("each lane seals the id under its own hash; an independent AES-GCM reader opens the file, which never holds the id in plaintext", async () => {
  const root = await sandbox();
  try {
    for (const lane of LANES) {
      const state = new StateStore(join(root, lane)); await state.initialize();
      const secret = Buffer.alloc(32, 5), spy = new FixedSecret(secret), store = new EncryptedProviderRequestReferenceStore(state, spy);
      const binding = bindingFor(lane);
      await assert.rejects(store.seal({ ...binding, referenceHash: "c".repeat(64) }, REQUEST), refused("APN_INTERNAL"),
        "an id is sealed only under its own hash");
      await assert.rejects(store.seal(binding, "not a request id"), refused("APN_INTERNAL"));
      assert.equal(await holdsSealedCustody(state), false);
      await store.seal(binding, REQUEST);
      assert.equal(await holdsSealedCustody(state), true, `${lane}: the sealed directory counts for the wrapping-secret guard`);
      assert.equal(await store.open(binding), REQUEST);
      const text = await readFile(sealedPath(state, binding), "utf8");
      assert.equal(text.includes(REQUEST), false);
      const file = JSON.parse(text) as Record<string, any>;
      assert.deepEqual(Object.keys(file).sort(), ["binding", "cipher", "kdf", "schemaVersion"]);
      assert.equal(file.schemaVersion, "apn.provider-request-reference-envelope.v1");
      assert.deepEqual(file.binding, binding);
      const format = nestedFormat("nonce", f => ["apn.provider-request-reference-envelope.v1", f.binding.lane, f.binding.providerId,
        f.binding.profileHash, f.binding.operationId, f.binding.referenceHash].join("\0"));
      assert.equal(referenceOpen(format, file, secret).toString("utf8"),
        canonicalJson({ schemaVersion: "apn.provider-request-reference.v1", reference: REQUEST }));
      assert.ok(spy.handed.length > 0);
      for (const copy of spy.handed) assert.ok(copy.every(byte => byte === 0), "a wrapping-secret copy was left unzeroed");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a seal that cannot be opened refuses precisely: missing, damaged, foreign, another secret, no secret, a refused Keychain", async (t) => {
  const root = await sandbox();
  try {
    const unmatched = refused("APN_STATE_CORRUPT", "provider_request_reference_unmatched");
    const cases: ReadonlyArray<readonly [string, (state: StateStore, store: EncryptedProviderRequestReferenceStore, secret: ReferenceTestSecret,
      binding: ProviderRequestReferenceBinding) => Promise<void>, (error: unknown) => boolean]> = [
      ["missing", async (state, _store, _secret, binding) => { await rm(sealedPath(state, binding)); }, unmatched],
      ["ciphertext changed", async (state, _store, _secret, binding) => { await rewrite(sealedPath(state, binding),
        v => ({ ...v, cipher: { ...v.cipher, ciphertext: flipped(v.cipher.ciphertext) } })); }, unmatched],
      ["tag changed", async (state, _store, _secret, binding) => { await rewrite(sealedPath(state, binding),
        v => ({ ...v, cipher: { ...v.cipher, tag: flipped(v.cipher.tag) } })); }, unmatched],
      ["binding changed", async (state, _store, _secret, binding) => { await rewrite(sealedPath(state, binding),
        v => ({ ...v, binding: { ...v.binding, referenceHash: "f".repeat(64) } })); }, unmatched],
      ["another operation's record", async (state, store, _secret, binding) => {
        const other = bindingFor(binding.lane, "e".repeat(64), "TEST-other-request");
        await store.seal(other, "TEST-other-request"); await copyFile(sealedPath(state, other), sealedPath(state, binding));
      }, unmatched],
      ["another wrapping secret", async (_state, _store, secret) => { secret.secret = Buffer.alloc(32, 9); }, unmatched],
      ["wrapping secret gone", async (_state, _store, secret) => { secret.secret = null; }, refused("APN_STATE_CORRUPT", "wrapping_secret_missing")],
      ["Keychain refused", async (_state, _store, secret) => { secret.failure = new ApnError("APN_NATIVE_REJECTED",
        "The APN login-Keychain wrapping secret is unavailable.", { nativeCode: "APN_KEYCHAIN_UNAVAILABLE" }); }, refused("APN_NATIVE_REJECTED")],
    ];
    for (const lane of LANES) for (const [name, damage, expected] of cases) await t.test(`${lane}: ${name}`, async () => {
      const state = new StateStore(join(root, `${lane}-${name.replaceAll(" ", "-").replaceAll("'", "")}`)); await state.initialize();
      const secret = new ReferenceTestSecret(), store = new EncryptedProviderRequestReferenceStore(state, secret), binding = bindingFor(lane);
      await store.seal(binding, REQUEST);
      await damage(state, store, secret, binding);
      await assert.rejects(store.open(binding), expected);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("readiness mints the first secret for a state that holds nothing sealed and never mints one over sealed state", async () => {
  const root = await sandbox();
  try {
    const state = new StateStore(join(root, "state")); await state.initialize();
    const secret = new ReferenceTestSecret(); secret.secret = null;
    const store = new EncryptedProviderRequestReferenceStore(state, secret);
    await store.ready();
    assert.notEqual(secret.secret, null, "the first wrapping secret was created");
    await store.seal(bindingFor("provider-direct"), REQUEST);
    secret.secret = null;
    await assert.rejects(store.ready(), refused("APN_STATE_CORRUPT", "wrapping_secret_missing"));
    await assert.rejects(store.seal(bindingFor("metamask-native"), REQUEST), refused("APN_STATE_CORRUPT", "wrapping_secret_missing"));
    secret.secret = Buffer.alloc(32, 7); secret.failure = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.");
    await assert.rejects(store.ready(), refused("APN_NATIVE_REJECTED"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
