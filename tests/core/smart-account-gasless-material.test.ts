import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createTimestampTerms, createValueLteTerms, hashDelegation } from "@metamask/delegation-core";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { decodeDelegations, encodeDelegations, toDelegationStruct } from "@metamask/smart-accounts-kit/utils";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { EncryptedSmartAccountGaslessMaterialStore,
  type UnsealedSmartAccountGaslessMaterial } from "../../src/encrypted-smart-account-gasless-material-store.js";
import type { SmartAccountPermissionStorePort } from "../../src/encrypted-smart-account-permission-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { GrantedSmartAccountPermissionRecord } from "../../src/metamask-smart-account-record.js";
import type { Address, Hex } from "../../src/model.js";
import { OfficialErc7710Engine, type Erc7710EnginePort } from "../../src/smart-account-erc7710/engine.js";
import { validateErc7710Material } from "../../src/smart-account-erc7710/validation.js";
import { SA_MATERIAL_DOMAINS, saMaterialHash, saRequirementsHash, saRootContextHash,
  saPolicyHash, saSalt } from "../../src/smart-account-gasless/integrity.js";
import { MetaMaskSmartAccountGaslessMaterial, SmartAccountGaslessMaterialValidator,
  directIntent } from "../../src/smart-account-gasless/material.js";
import type { SmartAccountGaslessIntent, SmartAccountGaslessMaterialDescriptor,
  SmartAccountGaslessPayload } from "../../src/smart-account-gasless/model.js";
import type { SmartAccountGaslessOperationRecord } from "../../src/smart-account-gasless/operation-model.js";
import { saRegistry } from "../../src/smart-account-gasless/registry.js";
import { observeSmartAccountGasless } from "../../src/smart-account-gasless/chain/observation.js";
import { initialSmartAccountGaslessCursor } from "../../src/smart-account-gasless/chain/scan.js";
import { SA_SINGLE_DEFAULT } from "../../src/smart-account-gasless/chain/abi.js";
import { StateStore } from "../../src/state.js";
import { domainHash } from "../../src/canonical.js";
import { temporaryState } from "./helpers.js";
import { saTestIntent } from "./smart-account-gasless-fixtures.js";
import { SA_OUTER, SA_RUNTIME_CODES, saQuantity, saRawBlock, saRawReceiptLog, saReceiptLogs,
  saSignedOuter, saTestBlock, saWord, type Json, type SmartAccountRedemptionFixture } from
  "./smart-account-gasless-chain-fixtures.js";

// Public synthetic keys only; no profile, Keychain or real facilitator custody is used.
const KEY = `0x${"2".repeat(64)}` as Hex;
const SESSION = privateKeyToAccount(KEY).address.toLowerCase() as Address;
const OWNER = privateKeyToAccount(`0x${"1".repeat(64)}` as Hex).address.toLowerCase() as Address;
const OPERATION = "4".repeat(64), FINGERPRINT = "5".repeat(64);
const execFileAsync = promisify(execFile);

class Secret implements WrappingSecretPort {
  constructor(readonly bytes: Buffer | null = Buffer.from("33".repeat(32), "hex")) {}
  async load(): Promise<Buffer | null> { return this.bytes === null ? null : Buffer.from(this.bytes); }
  async create(): Promise<Buffer> { throw new Error("direct material must never create custody"); }
}

async function record(operationId = OPERATION): Promise<UnsealedSmartAccountGaslessMaterial> {
  const root = encodeDelegations([{ delegate: SESSION, delegator: OWNER, authority: ROOT_AUTHORITY,
    caveats: [], salt: "0x01", signature: `0x${"11".repeat(65)}` }]).toLowerCase() as Hex;
  const source = saTestIntent(), decodedRoot = (await import("@metamask/smart-accounts-kit/utils")).decodeDelegations(root)[0]!;
  const intent = structuredClone(source) as SmartAccountGaslessIntent;
  (intent.binding as any).ownerAddress = OWNER; (intent.binding as any).sessionAddress = SESSION;
  (intent.binding as any).accountBindingHash = sha256(`provider-account-binding\0metamask-smart-account\0${OWNER}`);
  (intent.binding as any).encodedRootHash = saRootContextHash(root);
  (intent.binding as any).rootDelegationHash = hashDelegation(toDelegationStruct(decodedRoot)).toLowerCase();
  (intent.initialSnapshot.safeState as any).ownerAddress = OWNER;
  (intent.initialSnapshot.safeState as any).sessionAddress = SESSION;
  const neutral = directIntent(operationId, FINGERPRINT, intent, root);
  const payment = await new OfficialErc7710Engine().create(neutral, { sessionPrivateKey: KEY, rootContext: root });
  const validated = await validateErc7710Material(neutral, payment);
  const hashes = await new SmartAccountGaslessMaterialValidator().validate({ operationId, fingerprint: FINGERPRINT,
    intent, paymentPayload: payment as unknown as SmartAccountGaslessPayload, rootContext: root });
  const canonicalPayment: SmartAccountGaslessPayload = { x402Version: 2, accepted: intent.requirements,
    payload: { delegationManager: intent.binding.delegationManager, delegator: intent.binding.ownerAddress,
      permissionContext: validated.permissionContext } };
  assert.equal(hashes.encodedRootHash, saRootContextHash(root));
  assert.equal(hashes.encodedChildHash, domainHash(SA_MATERIAL_DOMAINS.encodedChild, validated.encodedChild));
  assert.equal(hashes.requirementsHash, saRequirementsHash(intent.requirements));
  assert.equal(hashes.materialHash, saMaterialHash(operationId, FINGERPRINT, {
    encodedRootHash: hashes.encodedRootHash, encodedChildHash: hashes.encodedChildHash,
    permissionContextHash: hashes.permissionContextHash, payloadHash: hashes.payloadHash,
    requirementsHash: hashes.requirementsHash, rootDelegationHash: hashes.rootDelegationHash,
    childDelegationHash: hashes.childDelegationHash }));
  return { schema_version: "apn.smart-account-gasless-material.v1", operation_id: operationId,
    profile_hash: intent.binding.profileHash, fingerprint: FINGERPRINT, request_hash: "6".repeat(64),
    root_grant_fingerprint: intent.binding.rootGrantFingerprint, ...hashes,
    delegation_manager: intent.binding.delegationManager, delegator: OWNER, root_context: validated.encodedRoot,
    encoded_child: validated.encodedChild, permission_context: validated.permissionContext,
    payment_payload_canonical_json: canonicalJson(canonicalPayment), phase: "sealed", sealed_at: intent.preparedAt,
    updated_at: intent.preparedAt };
}

test("operation-bound AES-GCM seal is idempotent, private and byte-stable across processes", async () => {
  const temporary = await temporaryState();
  try {
    const state = new StateStore(temporary.root); await state.initialize();
    const wrapping = new Secret(), store = new EncryptedSmartAccountGaslessMaterialStore(state, wrapping);
    const input = await record(), first = await store.seal(input), second = await store.seal(input);
    assert.deepEqual(second, first);
    const file = join(temporary.root, "smart-account-gasless-materials", `${OPERATION}.json`);
    const encrypted = await readFile(file, "utf8");
    for (const secret of [KEY, input.root_context, input.permission_context, input.payment_payload_canonical_json]) {
      assert.equal(encrypted.includes(secret), false);
    }
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const childScript = `
      import { EncryptedSmartAccountGaslessMaterialStore } from "./dist-test/src/encrypted-smart-account-gasless-material-store.js";
      import { StateStore } from "./dist-test/src/state.js";
      class SyntheticWrappingSecret {
        async load() { return Buffer.from("33".repeat(32), "hex"); }
        async create() { throw new Error("child recovery must not create custody"); }
      }
      const loaded = await new EncryptedSmartAccountGaslessMaterialStore(
        new StateStore(process.argv[1]), new SyntheticWrappingSecret(),
      ).load(process.argv[2]);
      if (loaded === null) throw new Error("missing material");
      process.stdout.write(JSON.stringify({ operationId: loaded.operation_id, profileHash: loaded.profile_hash,
        fingerprint: loaded.fingerprint, requestHash: loaded.request_hash, materialHash: loaded.materialHash,
        payloadHash: loaded.payloadHash, permissionContextHash: loaded.permissionContextHash,
        phase: loaded.phase, sealedAt: loaded.sealed_at }));
    `;
    const child = await execFileAsync(process.execPath,
      ["--input-type=module", "--eval", childScript, temporary.root, OPERATION],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 });
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), { operationId: first.operation_id, profileHash: first.profile_hash,
      fingerprint: first.fingerprint, requestHash: first.request_hash, materialHash: first.materialHash,
      payloadHash: first.payloadHash, permissionContextHash: first.permissionContextHash,
      phase: first.phase, sealedAt: first.sealed_at });
    for (const secret of [KEY, "33".repeat(32), input.root_context, input.permission_context,
      input.payment_payload_canonical_json]) assert.equal(`${child.stdout}${child.stderr}`.includes(secret), false);
    const exposed = await store.markExposed(OPERATION, new Date(Date.parse(input.sealed_at) + 1_000).toISOString());
    assert.equal(exposed.phase, "exposed"); assert.equal(exposed.sealed_at, input.sealed_at);
  } finally { await temporary.cleanup(); }
});

test("tampering, wrong operation binding and insecure files fail closed", async () => {
  const temporary = await temporaryState();
  try {
    const state = new StateStore(temporary.root); await state.initialize();
    const store = new EncryptedSmartAccountGaslessMaterialStore(state, new Secret());
    await store.seal(await record());
    const directory = join(temporary.root, "smart-account-gasless-materials");
    const file = join(directory, `${OPERATION}.json`), other = "7".repeat(64);
    const original = await readFile(file, "utf8"), swapped = JSON.parse(original);
    swapped.operation_id = other;
    await writeFile(join(directory, `${other}.json`), `${canonicalJson(swapped)}\n`);
    await assert.rejects(store.load(other));
    const envelope = JSON.parse(original), ciphertext = Buffer.from(envelope.cipher.ciphertext, "base64");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    envelope.cipher.ciphertext = ciphertext.toString("base64"); ciphertext.fill(0);
    await writeFile(file, `${canonicalJson(envelope)}\n`); await assert.rejects(store.load(OPERATION));
    await writeFile(file, original);
    await chmod(file, 0o644); await assert.rejects(store.load(OPERATION));
  } finally { await temporary.cleanup(); }
});

test("missing retained wrapping custody never creates a fallback key or plaintext seal", async () => {
  const temporary = await temporaryState();
  try {
    const state = new StateStore(temporary.root); await state.initialize();
    const store = new EncryptedSmartAccountGaslessMaterialStore(state, new Secret(null));
    await assert.rejects(store.seal(await record()));
    await assert.rejects(readFile(join(temporary.root, "smart-account-gasless-materials", `${OPERATION}.json`)));
    const exposed = { ...await record(), phase: "exposed" as const };
    await assert.rejects(new EncryptedSmartAccountGaslessMaterialStore(state, new Secret()).seal(exposed));
  } finally { await temporary.cleanup(); }
});

test("material inspection freezes independent profile, permission, exact periodic-root and nonce identity", async () => {
  const source = saTestIntent(), root = fourCaveatRoot(source);
  const permission = { phase: "active", profile_hash: source.binding.profileHash,
    revision: source.binding.permissionRevision, grant_fingerprint: source.binding.rootGrantFingerprint,
    owner_address: OWNER, session_address: SESSION, delegation_manager: source.binding.delegationManager,
    grant_context: root, session_private_key: KEY, granted_cap_atomic: source.binding.rootCapAtomic,
    granted_expires_at_unix: source.binding.rootExpiresAtUnix, starts_at_unix: source.binding.rootStartsAtUnix } as GrantedSmartAccountPermissionRecord;
  const permissions = { load: async () => permission } as unknown as SmartAccountPermissionStorePort;
  const temporary = await temporaryState();
  try {
    const state = new StateStore(temporary.root); await state.initialize();
    const adapter = new MetaMaskSmartAccountGaslessMaterial(permissions,
      new EncryptedSmartAccountGaslessMaterialStore(state, new Secret()));
    const binding = await adapter.inspect({ profile: source.profile, profileHash: source.binding.profileHash,
      address: OWNER, accountBindingHash: sha256(`provider-account-binding\0metamask-smart-account\0${OWNER}`),
      capabilityHash: source.binding.capabilityHash, revision: source.binding.profileRevision }, source.afterUnix);
    assert.equal(binding.profileRevision, 2); assert.equal(binding.permissionRevision, 1);
    assert.equal(binding.encodedRootHash, saRootContextHash(root));
    assert.equal(binding.rootCapAtomic, source.binding.rootCapAtomic);
    assert.equal(binding.periodTerms, source.binding.periodTerms);
    assert.equal(binding.rootNonceAtomic, source.binding.rootNonceAtomic);
  } finally { await temporary.cleanup(); }
});

test("public synthetic facilitator carries official material through the production observer and rejects wrong execution", async () => {
  // SA_OUTER is a public synthetic facilitator. This directly proves the T2 material -> T3 observer seam;
  // it does not claim top-level SmartAccountGaslessRpc.observe registry admission for a real facilitator.
  const temporary = await temporaryState();
  try {
    const source = saTestIntent(), root = fourCaveatRoot(source);
    const facilitator = SA_OUTER.address.toLowerCase() as Address, registry = saRegistry(8453);
    assert.equal((registry.facilitatorAddresses as readonly Address[]).includes(facilitator), false);
    assert.equal(decodeDelegations(root)[0]?.caveats.length, 4);
    const permission = { phase: "active", profile_hash: source.binding.profileHash,
      revision: source.binding.permissionRevision, grant_fingerprint: source.binding.rootGrantFingerprint,
      owner_address: OWNER, session_address: SESSION, delegation_manager: source.binding.delegationManager,
      grant_context: root, session_private_key: KEY, granted_cap_atomic: source.binding.rootCapAtomic,
      granted_expires_at_unix: source.binding.rootExpiresAtUnix,
      starts_at_unix: source.binding.rootStartsAtUnix } as GrantedSmartAccountPermissionRecord;
    const state = new StateStore(temporary.root); await state.initialize();
    const permissions = { load: async () => permission } as unknown as SmartAccountPermissionStorePort;
    const store = new EncryptedSmartAccountGaslessMaterialStore(state, new Secret());
    const validator = new SmartAccountGaslessMaterialValidator(), official = new OfficialErc7710Engine();
    const adapter = new MetaMaskSmartAccountGaslessMaterial(permissions, store, official, validator,
      () => new Date(source.preparedAt));
    const binding = await adapter.inspect({ profile: source.profile, profileHash: source.binding.profileHash,
      address: OWNER, accountBindingHash: sha256(`provider-account-binding\0metamask-smart-account\0${OWNER}`),
      capabilityHash: source.binding.capabilityHash, revision: source.binding.profileRevision }, source.afterUnix);
    assert.equal(binding.encodedRootHash, saRootContextHash(root));
    const partial = { ...source, binding,
      provider: { ...source.provider, facilitatorAddresses: [facilitator] },
      requirements: { ...source.requirements, extra: { ...source.requirements.extra,
        facilitatorAddresses: [facilitator] } },
      initialSnapshot: { ...source.initialSnapshot, safeState: { ...source.initialSnapshot.safeState,
        ownerAddress: OWNER, sessionAddress: SESSION } } };
    const intent = { ...partial, policyHash: saPolicyHash(binding, partial.request) } as SmartAccountGaslessIntent;
    const operation = markedOperation({ request_hash: "6".repeat(64) }, intent);
    const sealed = await adapter.seal(operation), reloaded = await adapter.load(operation);
    assert.deepEqual(reloaded, sealed);
    assert.equal(sealed.paymentPayload.payload.delegationManager, intent.binding.delegationManager);
    assert.equal(sealed.paymentPayload.payload.delegator, intent.binding.ownerAddress);
    const material = sealed.descriptor satisfies SmartAccountGaslessMaterialDescriptor;
    const [rawChild, rawRoot] = decodeDelegations(sealed.paymentPayload.payload.permissionContext);
    assert.ok(rawChild); assert.ok(rawRoot); assert.notEqual(rawChild.signature, "0x");
    const fixture = { intent, material, child: { ...rawChild, salt: BigInt(rawChild.salt) },
      root: { ...rawRoot, salt: BigInt(rawRoot.salt) }, permissionContext: sealed.paymentPayload.payload.permissionContext,
      rootContext: root, executionCallData: execution(intent.request.recipient, intent), calldata: "0x",
      validator } satisfies SmartAccountRedemptionFixture;
    const accepted = await crossLayerObservation(fixture, fixture.executionCallData);
    assert.equal(accepted.observation.phase, "success"); assert.ok(accepted.settlement);
    assert.equal(accepted.settlement.contextHash, material.permissionContextHash);
    const wrongRecipient = `0x${"44".repeat(20)}` as Address;
    const rejected = await crossLayerObservation(fixture, execution(wrongRecipient, intent));
    assert.equal(rejected.observation.phase, "invalid"); assert.equal(rejected.settlement, null);
    const invalidId = "7".repeat(64), invalidOperation = { ...operation, operationId: invalidId };
    const raw = await official.create(directIntent(invalidId, FINGERPRINT, intent, root),
      { sessionPrivateKey: KEY, rootContext: root });
    const invalid = { ...raw, payload: { ...raw.payload, delegator: wrongRecipient } };
    const invalidAdapter = new MetaMaskSmartAccountGaslessMaterial(permissions, store,
      { create: async () => invalid }, validator, () => new Date(source.preparedAt));
    await assert.rejects(invalidAdapter.seal(invalidOperation),
      (error: any) => error?.details?.reason === "sa_gasless_provider_protocol");
    assert.equal(await store.load(invalidId), null);
  } finally { await temporary.cleanup(); }
});

test("material adapter invokes the SDK signer once and retains a seal completed after expiry", async () => {
  const temporary = await temporaryState();
  try {
    const state = new StateStore(temporary.root); await state.initialize();
    const input = await record(), intent = saTestIntent() as SmartAccountGaslessIntent;
    (intent.binding as any).ownerAddress = OWNER; (intent.binding as any).sessionAddress = SESSION;
    (intent.binding as any).accountBindingHash = sha256(`provider-account-binding\0metamask-smart-account\0${OWNER}`);
    (intent.binding as any).encodedRootHash = input.encodedRootHash;
    (intent.binding as any).rootDelegationHash = input.rootDelegationHash;
    (intent.initialSnapshot.safeState as any).ownerAddress = OWNER;
    (intent.initialSnapshot.safeState as any).sessionAddress = SESSION;
    const permission = { phase: "active", profile_hash: intent.binding.profileHash, revision: intent.binding.permissionRevision,
      grant_fingerprint: intent.binding.rootGrantFingerprint, owner_address: OWNER, session_address: SESSION,
      delegation_manager: intent.binding.delegationManager, grant_context: input.root_context,
      session_private_key: KEY, granted_expires_at_unix: intent.binding.rootExpiresAtUnix } as GrantedSmartAccountPermissionRecord;
    const permissions = { load: async () => permission } as unknown as SmartAccountPermissionStorePort;
    let current = new Date(intent.preparedAt), calls = 0;
    const official = new OfficialErc7710Engine();
    const engine: Erc7710EnginePort = { create: async (neutral, custody) => {
      calls += 1; const payment = await official.create(neutral, custody);
      current = new Date((intent.beforeUnix + 2) * 1_000); return payment;
    } };
    const adapter = new MetaMaskSmartAccountGaslessMaterial(permissions,
      new EncryptedSmartAccountGaslessMaterialStore(state, new Secret()), engine,
      new SmartAccountGaslessMaterialValidator(), () => new Date(current));
    const operation = markedOperation(input, intent);
    const first = await adapter.seal(operation), second = await adapter.seal(operation);
    assert.deepEqual(second, first); assert.equal(calls, 1);
    assert.equal(Date.parse(first.descriptor.sealedAt), (intent.beforeUnix + 2) * 1_000);
    assert.deepEqual(await adapter.load(operation), first, "historical seal validation does not require current custody freshness");
  } finally { await temporary.cleanup(); }
});

test("material adapter refuses expiry, permission expiry and clock rollback during permission load before SDK signing", async (t) => {
  for (const scenario of ["operation-window", "permission-expiry", "rollback"] as const) await t.test(scenario, async () => {
    const temporary = await temporaryState();
    try {
      const state = new StateStore(temporary.root); await state.initialize();
      const input = await record(), intent = materialIntent(input);
      const initialUnix = scenario === "operation-window" ? intent.beforeUnix - 31 : intent.afterUnix + 20;
      const markerAt = scenario === "rollback" ? new Date(initialUnix * 1_000).toISOString() : intent.preparedAt;
      const operation = markedOperation(input, intent, markerAt);
      let current = new Date(initialUnix * 1_000), calls = 0;
      const permissionExpiry = scenario === "permission-expiry" ? initialUnix + 1 : intent.binding.rootExpiresAtUnix;
      const permission = materialPermission(input, intent, permissionExpiry);
      const permissions = { load: async () => {
        current = new Date((scenario === "operation-window" ? intent.beforeUnix - 29 :
          scenario === "permission-expiry" ? permissionExpiry : initialUnix - 1) * 1_000);
        return permission;
      } } as unknown as SmartAccountPermissionStorePort;
      const engine: Erc7710EnginePort = { create: async () => {
        calls += 1; throw new Error("SDK signer must not run");
      } };
      const adapter = new MetaMaskSmartAccountGaslessMaterial(permissions,
        new EncryptedSmartAccountGaslessMaterialStore(state, new Secret()), engine,
        new SmartAccountGaslessMaterialValidator(), () => new Date(current));
      const reason = scenario === "permission-expiry" ? "sa_gasless_permission" :
        scenario === "rollback" ? "sa_gasless_clock" : "sa_gasless_expired";
      await assert.rejects(adapter.seal(operation), (error: any) => error?.details?.reason === reason);
      assert.equal(calls, 0);
      assert.equal(await new EncryptedSmartAccountGaslessMaterialStore(state, new Secret()).load(OPERATION), null);
    } finally { await temporary.cleanup(); }
  });
});

function materialIntent(input: UnsealedSmartAccountGaslessMaterial): SmartAccountGaslessIntent {
  const intent = structuredClone(saTestIntent()) as SmartAccountGaslessIntent;
  (intent.binding as any).ownerAddress = OWNER; (intent.binding as any).sessionAddress = SESSION;
  (intent.binding as any).accountBindingHash = sha256(`provider-account-binding\0metamask-smart-account\0${OWNER}`);
  (intent.binding as any).encodedRootHash = input.encodedRootHash;
  (intent.binding as any).rootDelegationHash = input.rootDelegationHash;
  (intent.initialSnapshot.safeState as any).ownerAddress = OWNER;
  (intent.initialSnapshot.safeState as any).sessionAddress = SESSION;
  return intent;
}

function materialPermission(input: UnsealedSmartAccountGaslessMaterial, intent: SmartAccountGaslessIntent,
  expiresAt = intent.binding.rootExpiresAtUnix): GrantedSmartAccountPermissionRecord {
  return { phase: "active", profile_hash: intent.binding.profileHash, revision: intent.binding.permissionRevision,
    grant_fingerprint: intent.binding.rootGrantFingerprint, owner_address: OWNER, session_address: SESSION,
    delegation_manager: intent.binding.delegationManager, grant_context: input.root_context,
    session_private_key: KEY, granted_expires_at_unix: expiresAt } as GrantedSmartAccountPermissionRecord;
}

function markedOperation(input: Pick<UnsealedSmartAccountGaslessMaterial, "request_hash">,
  intent: SmartAccountGaslessIntent, markerAt = intent.preparedAt): SmartAccountGaslessOperationRecord {
  return { operationId: OPERATION, profileHash: intent.binding.profileHash, fingerprint: FINGERPRINT,
    requestHash: input.request_hash, intent, state: "material_pending", signingAttempts: 1, material: null,
    createdAt: intent.preparedAt, updatedAt: markerAt,
    approval: { fingerprint: FINGERPRINT, approvedAt: intent.preparedAt, expiresAt: intent.expiresAt },
    transitions: [{ at: markerAt }], exposureStartedAt: null, dispatchStartedAt: null,
    verification: null, providerSettlement: null, observation: null, settlement: null,
    unusedProof: null } as unknown as SmartAccountGaslessOperationRecord;
}

function fourCaveatRoot(source: SmartAccountGaslessIntent): Hex {
  const registry = saRegistry(8453);
  return encodeDelegations([{ delegate: SESSION, delegator: OWNER, authority: ROOT_AUTHORITY, caveats: [
    { enforcer: registry.protocol.period.address, terms: source.binding.periodTerms, args: "0x" },
    { enforcer: registry.protocol.value.address, terms: createValueLteTerms({ maxValue: 0n }), args: "0x" },
    { enforcer: registry.protocol.nonce.address,
      terms: `0x${BigInt(source.binding.rootNonceAtomic).toString(16).padStart(64, "0")}` as Hex, args: "0x" },
    { enforcer: registry.protocol.timestamp.address,
      terms: createTimestampTerms({ afterThreshold: 0, beforeThreshold: source.binding.rootExpiresAtUnix }), args: "0x" },
  ], salt: "0x01", signature: `0x${"11".repeat(65)}` }]).toLowerCase() as Hex;
}

function execution(recipient: Address, intent: SmartAccountGaslessIntent): Hex {
  const transfer = encodeFunctionData({ abi: parseAbi(["function transfer(address to,uint256 amount)"]),
    functionName: "transfer", args: [recipient, BigInt(intent.request.grossAtomic)] });
  return `${intent.token}${"0".repeat(64)}${transfer.slice(2)}` as Hex;
}

async function crossLayerObservation(fixture: SmartAccountRedemptionFixture, executionCallData: Hex) {
  const calldata = encodeFunctionData({ abi: parseAbi([
    "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
  ]), functionName: "redeemDelegations",
  args: [[fixture.permissionContext], [SA_SINGLE_DEFAULT], [executionCallData]] });
  const signed = await saSignedOuter(2, calldata, fixture.intent);
  const start = fixture.intent.initialSnapshot.preparationBlock;
  const included = saTestBlock(BigInt(start.numberAtomic) + 3n, BigInt(start.timestampAtomic) + 10n);
  const safe = saTestBlock(BigInt(start.numberAtomic) + 10n, BigInt(start.timestampAtomic) + 20n);
  const finalized = saTestBlock(BigInt(start.numberAtomic) + 9n, BigInt(start.timestampAtomic) + 18n);
  const logs = saReceiptLogs(fixture, signed.hash, included);
  const transaction = { ...signed.rpc, blockNumber: saQuantity(BigInt(included.numberAtomic)),
    blockHash: included.hash, transactionIndex: "0x0" };
  const receipt = { transactionHash: signed.hash, blockNumber: saQuantity(BigInt(included.numberAtomic)),
    blockHash: included.hash, transactionIndex: "0x0", type: signed.rpc.type,
    from: SA_OUTER.address.toLowerCase(), to: fixture.intent.binding.delegationManager, status: "0x1",
    logs: logs.map(log => saRawReceiptLog(log, signed.hash, included)) };
  const call = async (method: any, params: readonly unknown[]) => {
    if (method === "eth_getBlockByNumber") {
      const tag = params[0] as string;
      const number = tag === "safe" || tag === "finalized" ? null : BigInt(tag);
      const block = tag === "safe" ? safe : tag === "finalized" ? finalized :
        number === BigInt(included.numberAtomic) ? included : number === BigInt(safe.numberAtomic) ? safe :
          number === BigInt(finalized.numberAtomic) ? finalized : start;
      return saRawBlock(block, block.hash === included.hash ? [signed.hash] : []);
    }
    if (method === "eth_getLogs") {
      const address = (params[0] as Json).address;
      const log = address === saRegistry(8453).protocol.amount.address ? logs[3] : logs[0];
      return [saRawReceiptLog(log!, signed.hash, included)];
    }
    if (method === "eth_getTransactionByHash") return transaction;
    if (method === "eth_getTransactionReceipt") return receipt;
    return crossProofRead(method, params, fixture.intent);
  };
  return await observeSmartAccountGasless({ call, clock: { now: () => new Date(fixture.intent.preparedAt) },
    validator: fixture.validator }, { operationId: OPERATION, fingerprint: FINGERPRINT, intent: fixture.intent,
    material: fixture.material, cursor: initialSmartAccountGaslessCursor(fixture.intent), transactionHint: null });
}

function crossProofRead(method: string, params: readonly unknown[], intent: SmartAccountGaslessIntent): unknown {
  const registry = saRegistry(8453);
  if (method === "eth_getCode") {
    const address = String(params[0]).toLowerCase() as Address;
    if (address === intent.binding.ownerAddress) return registry.ownerDesignationCode;
    if (address === intent.binding.sessionAddress) return "0x";
    const code = (SA_RUNTIME_CODES as Readonly<Record<string, Hex>>)[address];
    if (code === undefined) throw new Error(`missing public runtime preimage ${address}`);
    return code;
  }
  if (method === "eth_getStorageAt") return saWord(BigInt(registry.token.implementationAddress));
  const selector = String((params[0] as Json).data).slice(0, 10);
  if (selector === "0x313ce567") return saWord(6n);
  if (selector === "0x3644e515") return registry.token.domainSeparator;
  if (selector === "0x9dd5d9ab") return saWord(BigInt(intent.request.grossAtomic));
  throw new Error(`unexpected proof read ${selector}`);
}
