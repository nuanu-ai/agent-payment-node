/**
 * QA F26: the pending MFA request reference of MetaMask native and provider direct transfers is kept encrypted. The
 * store seals it with the shared custody envelope under the wrapping secret; an independent AES-GCM reader opens the
 * file, the sealed directories count for the wrapping-secret guard, and every open that cannot succeed refuses
 * precisely. Synthetic wrapping secret only; the Keychain is never touched.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { EncryptedProviderRequestReferenceStore, listProviderRequestReferences, PROVIDER_REQUEST_REFERENCE_DIRECTORIES,
  providerRequestReferenceHash, type ProviderRequestReferenceBinding, type ProviderRequestReferenceLane } from "../../src/provider-request-reference-store.js";
import { StateStore } from "../../src/state.js";
import { holdsSealedCustody } from "../../src/wrapping-secret-custody.js";
import { FixedSecret, nestedFormat, referenceOpen } from "./custody-envelope-reference.js";
import { ReferenceTestSecret, flipped, rewrite, stateFiles } from "./provider-request-reference-helpers.js";

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

/**
 * 0.5.109: the MetaMask gasless delegation disable sends a new request on every revoke, so its lane keeps one sealed
 * record per request, `<directory>/<profile hash>/<operation id>/<reference hash>.json`, with the same envelope, HKDF info
 * and AAD binding as every lane, never replaced, and lists the hashes sealed for one operation.
 */
const REVOKE_REQUEST = "0b6e2f3a-5c1d-4e8f-9a7b-1c2d3e4f5a6b";
const revokeScope = { lane: "metamask-revocation", profileHash: "a".repeat(64), operationId: "b".repeat(64) } as const;
const revokeDirectory = (state: StateStore) => join(state.root, "metamask-revocation-request-references", "a".repeat(64), "b".repeat(64));

test("the revoke lane keeps one record per request under its operation, never replaced, and lists their hashes; the other lanes keep their paths", async () => {
  const root = await sandbox();
  try {
    const state = new StateStore(join(root, "state")); await state.initialize();
    const secret = Buffer.alloc(32, 5), store = new EncryptedProviderRequestReferenceStore(state, new FixedSecret(secret));
    const ids = [REQUEST, REVOKE_REQUEST], bindings = ids.map(id => bindingFor("metamask-revocation", "b".repeat(64), id));
    assert.deepEqual(await listProviderRequestReferences(state, revokeScope), [], "an operation with no request lists none");
    for (const [index, binding] of bindings.entries()) await store.seal(binding, ids[index]!);
    assert.deepEqual(await listProviderRequestReferences(state, revokeScope), bindings.map(binding => binding.referenceHash).sort());
    for (const [index, binding] of bindings.entries()) assert.equal(await store.open(binding), ids[index]);
    const path = join(revokeDirectory(state), `${bindings[0]!.referenceHash}.json`), text = await readFile(path, "utf8");
    assert.equal(text.includes(REQUEST), false);
    const file = JSON.parse(text) as Record<string, any>;
    assert.equal(file.schemaVersion, "apn.provider-request-reference-envelope.v1"); assert.deepEqual(file.binding, bindings[0]);
    const format = nestedFormat("nonce", f => ["apn.provider-request-reference-envelope.v1", f.binding.lane, f.binding.providerId,
      f.binding.profileHash, f.binding.operationId, f.binding.referenceHash].join("\0"));
    assert.equal(referenceOpen(format, file, secret).toString("utf8"),
      canonicalJson({ schemaVersion: "apn.provider-request-reference.v1", reference: REQUEST }));
    // Never replaced: the same request sealed again refuses, and the first record stays as written.
    await assert.rejects(store.seal(bindings[0]!, REQUEST), refused("APN_STATE_SECURITY"));
    assert.equal(await readFile(path, "utf8"), text);
    // The per-operation lanes keep the paths 0.5.108 wrote, beside the revoke lane's per-request files.
    for (const lane of LANES) await store.seal(bindingFor(lane), REQUEST);
    const sealedFiles = [...(await stateFiles(state.root)).keys()].map(file => relative(state.root, file))
      .filter(file => file.includes("-request-references")).sort();
    assert.deepEqual(sealedFiles, [
      join("metamask-native-request-references", "a".repeat(64), `${"b".repeat(64)}.json`),
      ...bindings.map(binding => join("metamask-revocation-request-references", "a".repeat(64), "b".repeat(64), `${binding.referenceHash}.json`)).sort(),
      join("provider-direct-request-references", "a".repeat(64), `${"b".repeat(64)}.json`),
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a revoke lane listing holds only the names the store writes; anything else refuses it, and only that lane lists", async (t) => {
  const root = await sandbox();
  try {
    const invalid = refused("APN_STATE_CORRUPT", "provider_request_reference_listing_invalid");
    const cases: ReadonlyArray<readonly [string, (directory: string, sealed: string) => Promise<unknown>]> = [
      ["a dotfile", async directory => await writeFile(join(directory, ".DS_Store"), "", { mode: 0o600 })],
      ["another name", async directory => await writeFile(join(directory, "note.json"), "{}", { mode: 0o600 })],
      ["an upper-case hash", async directory => await writeFile(join(directory, `${"A".repeat(64)}.json`), "{}", { mode: 0o600 })],
      ["a directory", async directory => await mkdir(join(directory, `${"c".repeat(64)}.json`), { mode: 0o700 })],
      ["a link", async (directory, sealed) => await symlink(sealed, join(directory, `${"d".repeat(64)}.json`))],
    ];
    for (const [name, damage] of cases) await t.test(name, async () => {
      const state = new StateStore(join(root, name.replaceAll(" ", "-"))); await state.initialize();
      const store = new EncryptedProviderRequestReferenceStore(state, new ReferenceTestSecret());
      const binding = bindingFor("metamask-revocation", "b".repeat(64), REVOKE_REQUEST);
      await store.seal(binding, REVOKE_REQUEST);
      await damage(revokeDirectory(state), join(revokeDirectory(state), `${binding.referenceHash}.json`));
      await assert.rejects(listProviderRequestReferences(state, revokeScope), invalid, "never skipped");
    });
    const state = new StateStore(join(root, "lanes")); await state.initialize();
    for (const lane of LANES) await assert.rejects(listProviderRequestReferences(state, { ...revokeScope, lane }), refused("APN_INTERNAL"),
      `${lane} keeps one record per operation and has nothing to list`);
    await assert.rejects(listProviderRequestReferences(state, { ...revokeScope, operationId: "not-a-hash" }), refused("APN_INTERNAL"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the wrapping-secret guard reads the revoke lane one level deeper: an empty operation directory holds nothing, a record does", async () => {
  const root = await sandbox();
  try {
    const state = new StateStore(join(root, "state")); await state.initialize();
    await mkdir(revokeDirectory(state), { recursive: true, mode: 0o700 });
    await writeFile(join(revokeDirectory(state), ".DS_Store"), "", { mode: 0o600 });
    assert.equal(await holdsSealedCustody(state), false, "an operation directory a failed first seal left holds nothing sealed");
    await mkdir(join(revokeDirectory(state), "deeper"), { mode: 0o700 });
    assert.equal(await holdsSealedCustody(state), true, "a directory deeper than the store lays out fails closed");
    await rm(join(revokeDirectory(state), "deeper"), { recursive: true });
    await new EncryptedProviderRequestReferenceStore(state, new ReferenceTestSecret()).seal(bindingFor("metamask-revocation", "b".repeat(64),
      REVOKE_REQUEST), REVOKE_REQUEST);
    assert.equal(await holdsSealedCustody(state), true, "a sealed request record counts");
  } finally { await rm(root, { recursive: true, force: true }); }
});
