import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedWalletStore, type WalletIdentity, type WalletSecretState } from "../../src/encrypted-wallet-store.js";
import { EncryptedProviderAuthorizationStore } from "../../src/encrypted-provider-authorization-store.js";
import { ApnError } from "../../src/errors.js";
import { LocalGaslessCustody } from "../../src/gasless/custody.js";
import { gaslessFee, gaslessGas } from "../../src/gasless/economics.js";
import { GaslessOperationRepository } from "../../src/gasless/operation-repository.js";
import type { GaslessBootstrapMaterial, GaslessUserOperationMaterial } from "../../src/gasless/ports.js";
import type { GaslessEstimate, GaslessIntent, GaslessSnapshot } from "../../src/gasless/model.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { gaslessOwner } from "../../src/gasless/owner.js";
import { gaslessDeployment, gaslessProtocolHash } from "../../src/gasless/registry.js";
import { newGaslessOperation, transitionGasless } from "../../src/gasless/transitions.js";
import { gaslessBatch, gaslessEnvelopeBinding, gaslessUserOperation } from "../../src/gasless/wire.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import type { ProviderAdapterBundle } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { accountBindingHash, capabilityHash, coinbaseDirectCapabilitySnapshot, type ProviderProfileRecord } from "../../src/provider-profile.js";
import { ProviderX402Repository } from "../../src/provider-x402-repository.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { EVM_REQUEST, evmCore } from "./evm-helpers.js";
import { GaslessApproval, GaslessTestRpc, gaslessFixture as gaslessCoreFixture } from "./gasless-helpers.js";
import { TestNative, TestProfilePolicy, TestRpc, temporaryState } from "./helpers.js";
import { LIFI_SYNTHETIC_KEY, lifiFixture } from "./lifi-helpers.js";
import { SOL_RECIPIENT, solanaFixture } from "./solana-helpers.js";
import { TestHttp } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const MASTER = Buffer.from("6d".repeat(32), "hex");
const PREPARED = "2026-09-09T00:00:00.000Z";
const EXPIRES = "2026-09-09T00:05:00.000Z";
const RECIPIENT = "0x4444444444444444444444444444444444444444" as Address;

class TestWrappingSecret implements WrappingSecretPort {
  loads = 0;
  creates = 0;
  async load(): Promise<Buffer> { this.loads += 1; return Buffer.from(MASTER); }
  async create(): Promise<Buffer> { this.creates += 1; return Buffer.from(MASTER); }
}

test("local gasless custody seals bootstrap once without changing or creating wallet custody", async (t) => {
  for (const delegation of ["empty", "expected"] as const) {
    const fixture = await gaslessFixture(`gasless-${delegation}`, delegation);
    t.after(fixture.cleanup);
    const walletPath = join(fixture.root, "wallets", `${fixture.owner.profile}.json`);
    const walletBefore = await readFile(walletPath, "utf8");
    const sealed = await fixture.custody.seal(fixture.bootstrapOp, "bootstrap", fixture.owner);
    assert.equal(sealed.role, "bootstrap");
    assert.equal(sealed.authorization !== null, delegation === "empty");
    assert.equal(fixture.wrapping.creates, 0);
    assert.equal(await readFile(walletPath, "utf8"), walletBefore);

    const effectPath = effectFile(fixture, "bootstrap");
    const effectBefore = await readFile(effectPath, "utf8");
    const repeated = await fixture.custody.seal(fixture.bootstrapOp, "bootstrap", fixture.owner);
    assert.deepEqual(repeated, sealed);
    assert.equal(await readFile(effectPath, "utf8"), effectBefore, "repeat must not rewrite or re-sign");
    assert.equal(effectBefore.includes(sealed.permitSignature), false);
    if (sealed.authorization !== null) assert.equal(effectBefore.includes(sealed.authorization.r), false);
  }
});

test("final seal is restart-stable and binds the original bootstrap plus checked estimate", async (t) => {
  const fixture = await gaslessFixture("gasless-final", "empty");
  t.after(fixture.cleanup);
  const bootstrap = await fixture.custody.seal(
    fixture.bootstrapOp,
    "bootstrap",
    fixture.owner,
  ) as GaslessBootstrapMaterial;
  const branch = checkedFinalOperation(fixture.bootstrapOp, bootstrap, "a".repeat(64));
  const sealed = await fixture.custody.seal(
    branch.operation,
    "user_operation",
    fixture.owner,
    bootstrap,
  ) as GaslessUserOperationMaterial;
  assert.equal(sealed.bootstrapMaterialHash, bootstrap.materialHash);
  assert.equal(sealed.estimateHash, hashObject(branch.estimate));
  assert.deepEqual(
    sealed.userOperation,
    gaslessUserOperation(branch.operation.intent, bootstrap, sealed.userOperation.signature),
  );

  const restarted = new LocalGaslessCustody(fixture.state, fixture.wrapping, fixture.now);
  assert.deepEqual(await restarted.load(branch.operation, "bootstrap"), bootstrap);
  assert.deepEqual(await restarted.load(branch.operation, "user_operation"), sealed);
  const finalPath = effectFile(fixture, "user_operation");
  const encrypted = await readFile(finalPath, "utf8");
  assert.equal(encrypted.includes(bootstrap.permitSignature), false);
  assert.equal(encrypted.includes(sealed.userOperation.signature), false);
  assert.equal(encrypted.includes(fixture.privateKey), false);
  assert.equal(JSON.stringify(branch.operation).includes(sealed.userOperation.signature), false);

  const alternate = checkedFinalOperation(fixture.bootstrapOp, bootstrap, "b".repeat(64));
  await rejectsCode(restarted.load(alternate.operation, "user_operation"), "APN_STATE_CORRUPT");

  const envelope = JSON.parse(encrypted) as { fingerprint: string };
  envelope.fingerprint = "f".repeat(64);
  await writeFile(finalPath, `${canonicalJson(envelope)}\n`, { encoding: "utf8", mode: 0o600 });
  await rejectsCode(restarted.load(branch.operation, "user_operation"), "APN_STATE_CORRUPT");
});

test("signing gates and changed encrypted keys fail before a new gasless effect", async (t) => {
  const fixture = await gaslessFixture("gasless-gates", "expected");
  t.after(fixture.cleanup);
  await rejectsCode(
    fixture.custody.seal(fixture.initialOperation, "bootstrap", fixture.owner),
    "APN_PROVIDER_EFFECT_UNAVAILABLE",
  );
  assert.equal(fixture.wrapping.loads, 0, "unapproved work must not load a key");

  const expired = new LocalGaslessCustody(
    fixture.state,
    fixture.wrapping,
    () => Date.parse(EXPIRES) - 14_999,
  );
  await rejectsCode(
    expired.seal(fixture.bootstrapOp, "bootstrap", fixture.owner),
    "APN_REPREPARE_REQUIRED",
  );
  assert.equal(fixture.wrapping.loads, 0, "expired work must not load a key");

  const wallets = new EncryptedWalletStore(fixture.state, fixture.wrapping);
  const hostileSecret: WalletSecretState = {
    version: "apn.wallet-secret.v1",
    privateKey: generatePrivateKey(),
    directEffects: {},
    x402Effects: {},
  };
  await wallets.save(fixture.identity, hostileSecret, Buffer.from(MASTER));
  await rejectsCode(
    fixture.custody.seal(fixture.bootstrapOp, "bootstrap", fixture.owner),
    "APN_STATE_CORRUPT",
  );
  await assert.rejects(stat(effectFile(fixture, "bootstrap")), { code: "ENOENT" });
  assert.equal(fixture.wrapping.creates, 0);
});

test("gasless repository initialization preserves local-wallet, provider-authorization, and unresolved direct identities", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const gasless = await gaslessCoreFixture(temporary.root);
  const direct = evmCore(temporary.root, undefined, gasless.wrapping);
  const directResult = await direct.core.execute({
    ...EVM_REQUEST,
    profile: gasless.profile,
    idempotencyKey: "older-direct-preserved-0001",
  });
  assert.equal(directResult.ok, true, directResult.error?.message);
  const directId = (directResult.operation as { operation_id: string }).operation_id;
  const directBefore = await direct.state.findOperation(directId);
  assert.ok(directBefore);
  assert.equal(directBefore.terminal, false);

  const providerId = gasless.state.operationId(gasless.profile, "synthetic-provider-envelope-0001");
  const providerBinding = {
    profile: gasless.profile,
    profileHash: gasless.state.profileHash(gasless.profile),
    operationId: providerId,
    fingerprint: hashObject("synthetic-provider-fingerprint"),
    wallet: gasless.account.address.toLowerCase() as Address,
    providerId: "synthetic-provider",
    profileRevision: 1,
    capabilityHash: hashObject("synthetic-provider-capability"),
    accountBindingHash: hashObject("synthetic-provider-account"),
  };
  await new EncryptedProviderAuthorizationStore(gasless.state, gasless.wrapping).save(providerBinding, {
    schemaVersion: "apn.provider-authorization.v1",
    phase: "invocation_started",
    requestHash: hashObject("synthetic-provider-request"),
    updatedAt: gasless.now.toISOString(),
  });

  const profileHash = gasless.state.profileHash(gasless.profile);
  const paths = [
    join(temporary.root, "wallets", `${gasless.profile}.json`),
    join(temporary.root, "wallets", profileHash, "wallet.json"),
    join(temporary.root, "provider-authorizations", profileHash, `${providerId}.json`),
    join(temporary.root, "operations", profileHash, `${directId}.json`),
  ];
  const bytesBefore = await Promise.all(paths.map(async (path) => await readFile(path)));
  for (let index = 0; index < 3; index += 1) {
    await new StateStore(temporary.root).initialize();
    assert.deepEqual(await new GaslessOperationRepository(temporary.root).listAllOperations(), []);
  }
  const bytesAfter = await Promise.all(paths.map(async (path) => await readFile(path)));
  assert.deepEqual(bytesAfter, bytesBefore);

  const directAfter = await new StateStore(temporary.root).findOperation(directId);
  assert.ok(directAfter);
  for (const field of ["operationId", "idempotencyHash", "requestHash", "profileHash", "fingerprint"] as const) {
    assert.equal(directAfter[field], directBefore[field]);
  }
  const blocked = await gasless.core.execute({
    command: "gasless.transfer.prepare",
    profile: gasless.profile,
    request: gasless.request,
    idempotencyKey: "gasless-behind-older-direct-0001",
  });
  assert.equal(blocked.error?.code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(await gasless.core.gasless.records.listOperations(profileHash), []);
  assert.equal(gasless.rpc.calls.length, 0, "the active direct operation must block before gasless RPC access");
  assert.deepEqual(await Promise.all(paths.map(async (path) => await readFile(path))), bytesBefore);
});

test("an active gasless operation blocks a new direct prepare for the same profile", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const gasless = await gaslessCoreFixture(temporary.root);
  const active = await gasless.prepare("active-gasless-before-direct-0001");
  const direct = evmCore(temporary.root, undefined, gasless.wrapping);
  const blocked = await direct.core.execute({
    ...EVM_REQUEST,
    profile: gasless.profile,
    idempotencyKey: "direct-behind-gasless-0001",
  });
  assert.equal(blocked.error?.code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(await direct.state.listOperations(active.operation.profileHash), []);
  assert.equal(direct.rpc.genericBalanceCalls, 0, "the active gasless operation must block before direct RPC access");
  assert.deepEqual(await gasless.record(active.id), active.operation);
});

test("concurrent direct and gasless prepares serialize one shared idempotency identity", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const gasless = await gaslessCoreFixture(temporary.root);
  const direct = evmCore(temporary.root, undefined, gasless.wrapping);
  const idempotencyKey = "cross-family-concurrent-0001";
  const [gaslessResult, directResult] = await Promise.all([
    gasless.core.execute({
      command: "gasless.transfer.prepare",
      profile: gasless.profile,
      request: gasless.request,
      idempotencyKey,
    }),
    direct.core.execute({ ...EVM_REQUEST, profile: gasless.profile, idempotencyKey }),
  ]);
  const results = [gaslessResult, directResult];
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.filter((result) => !result.ok).map((result) => result.error?.code), ["APN_IDEMPOTENCY_CONFLICT"]);

  const profileHash = gasless.state.profileHash(gasless.profile);
  const gaslessOperations = await gasless.core.gasless.records.listOperations(profileHash);
  const directOperations = await direct.state.listOperations(profileHash);
  assert.equal(gaslessOperations.length + directOperations.length, 1);
  const winner = [...gaslessOperations, ...directOperations][0]!;
  assert.equal(winner.operationId, gasless.state.operationId(gasless.profile, idempotencyKey));
  assert.equal(winner.idempotencyHash, gasless.state.idempotencyHash(idempotencyKey));
  assert.equal(gasless.rpc.calls.length > 0, gaslessOperations.length === 1);
  assert.equal(direct.rpc.genericBalanceCalls > 0, directOperations.length === 1);
});

async function gaslessFixture(profile: string, delegation: "empty" | "expected") {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  await state.initialize();
  const wrapping = new TestWrappingSecret();
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const createdAt = "2026-09-08T23:55:00.000Z";
  const identity: WalletIdentity = {
    profile,
    address: account.address,
    chainId: 8453,
    createdAt,
    bindingHash: hashObject({ profile, address: account.address, createdAt }),
  };
  const secret: WalletSecretState = {
    version: "apn.wallet-secret.v1",
    privateKey,
    directEffects: {},
    x402Effects: {},
  };
  await new EncryptedWalletStore(state, wrapping).save(identity, secret, Buffer.from(MASTER));
  const profileHash = state.profileHash(profile);
  await state.writeWallet(sealWallet({
    schemaVersion: "apn.state.v1",
    profile,
    profileHash,
    address: account.address,
    createdAt,
    bindingHash: identity.bindingHash,
  }));
  const { owner, providerBinding } = await gaslessOwner(state, profile);
  const intent = gaslessIntent(owner, providerBinding, delegation);
  const initialOperation = newGaslessOperation({
    profileHash,
    operationId: state.operationId(profile, `gasless-${delegation}-001`),
    idempotencyHash: state.idempotencyHash(`gasless-${delegation}-001`),
    requestHash: hashObject({ profile, request: intent.request }),
    intent,
  });
  const approval = {
    policy: "apn.gasless.foreground-approval.v1" as const,
    fingerprint: initialOperation.fingerprint,
    approvedAt: at(1),
    expiresAt: EXPIRES,
  };
  const bootstrapOp = transitionGasless(initialOperation, {
    state: "execution_pending",
    approval,
    bootstrap: {
      ...initialOperation.bootstrap,
      phase: "signing_started",
      signingAttempts: 1,
      signingStartedAt: at(1),
    },
  }, at(1));
  const now = () => Date.parse(at(2));
  return {
    ...temporary,
    state,
    wrapping,
    identity,
    privateKey,
    owner,
    initialOperation,
    bootstrapOp,
    now,
    custody: new LocalGaslessCustody(state, wrapping, now),
  };
}

function gaslessIntent(
  owner: Awaited<ReturnType<typeof gaslessOwner>>["owner"],
  providerBinding: Awaited<ReturnType<typeof gaslessOwner>>["providerBinding"],
  delegation: "empty" | "expected",
): GaslessIntent {
  const deployment = gaslessDeployment(8453);
  const snapshot: GaslessSnapshot = {
    chainId: 8453,
    rpcOrigin: "https://rpc.example",
    rpcEndpointHash: "6".repeat(64),
    bundlerOrigin: "https://bundler.example",
    bundlerEndpointHash: "7".repeat(64),
    block: { numberAtomic: "100", hash: `0x${"ab".repeat(32)}`, timestampAtomic: "1788912000" },
    protocolHash: gaslessProtocolHash(deployment),
    owner: owner.address,
    token: deployment.token,
    balanceAtomic: "10000000",
    nativeBalanceWei: "0",
    allowanceAtomic: "0",
    permitNonceAtomic: "7",
    entryPointNonceAtomic: "9",
    eoaNonceAtomic: "0",
    pendingEoaNonceAtomic: "0",
    delegation,
    feeConfiguration: { additionalGasCharge: "35000", feeSpread: "100", nativeTokenPrice: "2500000000" },
    baseFeePerGas: "1000000000",
    maxFeePerGas: "2100000000",
    maxPriorityFeePerGas: "100000000",
  };
  const gas = gaslessGas(snapshot);
  const feeCapAtomic = gaslessFee(gas, snapshot.feeConfiguration);
  const grossAtomic = "10000000";
  const recipientAtomic = (BigInt(grossAtomic) - BigInt(feeCapAtomic)).toString();
  const withoutHash = {
    profile: owner.profile,
    request: { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic, maxFeeAtomic: "6000000", minReceivedAtomic: "4000000" },
    owner,
    providerBinding,
    initialSnapshot: snapshot,
    gas,
    token: deployment.token,
    tokenDomain: deployment.tokenDomain,
    paymaster: deployment.paymaster,
    entryPoint: deployment.entryPoint,
    delegate: deployment.delegate,
    feeCapAtomic,
    recipientAtomic,
    callData: gaslessBatch(deployment.token, RECIPIENT, recipientAtomic, deployment.paymaster),
    preparedAt: PREPARED,
    expiresAt: EXPIRES,
    policyHash: hashObject({ identity: "apn.gasless.foreground-approval.v1", request: {
      chainId: 8453, recipient: RECIPIENT, grossAtomic, maxFeeAtomic: "6000000", minReceivedAtomic: "4000000",
    } }),
  };
  return { ...withoutHash, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(withoutHash)) };
}

function checkedFinalOperation(
  started: GaslessOperationRecord,
  bootstrap: GaslessBootstrapMaterial,
  responseHash: string,
): { operation: GaslessOperationRecord; estimate: GaslessEstimate } {
  let operation = transitionGasless(started, {
    state: "bootstrap_pending",
    bootstrap: { ...started.bootstrap, phase: "sealed", materialHash: bootstrap.materialHash, sealedAt: at(2) },
  }, at(2));
  operation = transitionGasless(operation, {
    bootstrap: { ...operation.bootstrap, phase: "disclosure_started", disclosureAttempts: 1, disclosedAt: at(3) },
  }, at(3));
  const { maxFeePerGas: _maxFee, maxPriorityFeePerGas: _priority, ...gasOnly } = operation.intent.gas;
  const estimate: GaslessEstimate = { ...gasOnly, responseHash };
  operation = transitionGasless(operation, {
    state: "user_operation_pending",
    bootstrap: { ...operation.bootstrap, phase: "checked", estimate },
  }, at(4));
  operation = transitionGasless(operation, {
    userOperation: {
      ...operation.userOperation,
      phase: "signing_started",
      signingAttempts: 1,
      signingStartedAt: at(5),
    },
  }, at(5));
  return { operation, estimate };
}

function effectFile(fixture: { root: string; owner: { profileHash: string }; bootstrapOp: GaslessOperationRecord }, role: string): string {
  return join(fixture.root, "gasless-effects", fixture.owner.profileHash, `${fixture.bootstrapOp.operationId}-${role}.json`);
}

function at(seconds: number): string {
  return new Date(Date.parse(PREPARED) + seconds * 1_000).toISOString();
}

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as ApnError).code, code);
    return true;
  });
}

test("concurrent legacy direct and gasless preparation preserves the same-profile guard in both orders", { timeout: 15_000 }, async (t) => {
  for (const first of ["gasless", "direct"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const gasless = await gaslessCoreFixture(temporary.root), direct = evmCore(temporary.root, undefined, gasless.wrapping);
    const profileHash = gasless.state.profileHash(gasless.profile), gate = new BoundaryGate();
    const loserState = new LockObservedState(temporary.root, `profile:${profileHash}`);
    const gaslessCore = new ApnCore({ state: first === "gasless" ? gasless.state : loserState,
      gasless: gasless.dependencies, clock: { now: () => new Date(gasless.now) } });
    const directCore = first === "direct" ? direct.core : new ApnCore({ state: loserState,
      rpc: direct.rpc, native: direct.local, clock: direct.clock });
    const originalSnapshot = gasless.rpc.snapshot.bind(gasless.rpc);
    const originalBalance = direct.rpc.evm.balance.bind(direct.rpc.evm);
    if (first === "gasless") gasless.rpc.snapshot = async (owner) => { await gate.hold(); return await originalSnapshot(owner); };
    else direct.rpc.evm.balance = async (address, selection) => { await gate.hold(); return await originalBalance(address, selection); };
    const wrappingBefore = gasless.wrapping.loads;
    const gaslessInput = { command: "gasless.transfer.prepare" as const, profile: gasless.profile,
      request: gasless.request, idempotencyKey: `direct-${first}-gasless` };
    const directInput = { ...EVM_REQUEST, profile: gasless.profile, idempotencyKey: `direct-${first}-legacy` };
    const winner = first === "gasless" ? gaslessCore.execute(gaslessInput) : directCore.execute(directInput);
    await gate.started;
    const loser = first === "gasless" ? directCore.execute(directInput) : gaslessCore.execute(gaslessInput);
    await loserState.attempted; gate.release();
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);
    assert.equal(winnerResult.ok, true, winnerResult.error?.message);
    assert.equal(loserResult.error?.code, "APN_OPERATION_BLOCKED");
    const gaslessOperations = await gasless.core.gasless.records.listOperations(profileHash);
    const directOperations = await direct.state.listOperations(profileHash);
    assert.equal(gaslessOperations.length, first === "gasless" ? 1 : 0);
    assert.equal(directOperations.length, first === "direct" ? 1 : 0);
    const operations = [...gaslessOperations, ...directOperations];
    assert.equal(operations.length, 1); assert.equal(operations[0]?.terminal, false);
    assert.equal(operations[0]?.operationId, gasless.state.operationId(gasless.profile,
      first === "gasless" ? gaslessInput.idempotencyKey : directInput.idempotencyKey));
    if (first === "gasless") assert.equal(direct.rpc.genericBalanceCalls, 0);
    else assert.equal(gasless.rpc.calls.length, 0);
    assert.equal(gasless.wrapping.loads, wrappingBefore); assert.equal(direct.approval.intents.length, 0);
    assert.equal(direct.rpc.broadcastCount, 0); assert.equal(direct.rpc.submissions.length, 0);
    assert.equal(gasless.rpc.sends.length, 0); assert.equal(gasless.approval.calls.length, 0);
  }
});

test("concurrent local x402 and gasless preparation preserves the same-profile guard in both orders", { timeout: 15_000 }, async (t) => {
  for (const first of ["gasless", "x402"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const fixture = await gaslessCoreFixture(temporary.root);
    const gate = new BoundaryGate(), profileLock = `profile:${fixture.state.profileHash(fixture.profile)}`;
    const loserState = new LockObservedState(temporary.root, profileLock);
    const x402Rpc = new TestRpc();
    x402Rpc.x402Evidence = { ...x402Rpc.x402Evidence, address: fixture.account.address,
      observedAt: fixture.now.toISOString(), block: { ...x402Rpc.x402Evidence.block,
        timestamp: Math.floor(fixture.now.getTime() / 1_000).toString() } };
    const http = new TestHttp(), policy = new TestProfilePolicy(), native = new TestNative();
    const gaslessCore = new ApnCore({ state: first === "gasless" ? fixture.state : loserState,
      gasless: fixture.dependencies, clock: { now: () => new Date(fixture.now) } });
    const x402Core = new ApnCore({ state: first === "x402" ? new StateStore(temporary.root) : loserState,
      rpc: x402Rpc, http, policy, native, clock: { now: () => new Date(fixture.now) } });
    const originalSnapshot = fixture.rpc.snapshot.bind(fixture.rpc);
    if (first === "gasless") fixture.rpc.snapshot = async (owner) => { await gate.hold(); return await originalSnapshot(owner); };
    else {
      const originalGet = http.get.bind(http);
      http.get = async (request) => { await gate.hold(); return await originalGet(request); };
    }
    const wrappingBefore = fixture.wrapping.loads;
    const gaslessInput = { command: "gasless.transfer.prepare" as const, profile: fixture.profile,
      request: fixture.request, idempotencyKey: `local-x402-${first}-gasless` };
    const x402Input = { command: "x402.fetch.prepare" as const, profile: fixture.profile, url: X402_URL,
      maxAmountAtomic: "10000000", idempotencyKey: `local-x402-${first}-x402` };
    const winner = first === "gasless" ? gaslessCore.execute(gaslessInput) : x402Core.execute(x402Input);
    await gate.started;
    const loser = first === "gasless" ? x402Core.execute(x402Input) : gaslessCore.execute(gaslessInput);
    await loserState.attempted; gate.release();
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);
    assert.equal(winnerResult.ok, true, winnerResult.error?.message);
    assert.equal(loserResult.error?.code, "APN_OPERATION_BLOCKED");
    const gaslessOperations = await fixture.core.gasless.records.listAllOperations();
    const x402Operations = await fixture.state.listAllX402Operations();
    assert.equal(gaslessOperations.length, first === "gasless" ? 1 : 0);
    assert.equal(x402Operations.length, first === "x402" ? 1 : 0);
    const operations = [...gaslessOperations, ...x402Operations];
    assert.equal(operations.length, 1); assert.equal(operations[0]?.terminal, false);
    assert.equal(operations[0]?.operationId, fixture.state.operationId(fixture.profile,
      first === "gasless" ? gaslessInput.idempotencyKey : x402Input.idempotencyKey));
    if (first === "gasless") {
      assert.equal(http.calls.length, 0); assert.equal(x402Rpc.x402PrepareCalls, 0);
    } else {
      assert.equal(fixture.rpc.calls.length, 0); assert.equal(fixture.wrapping.loads, wrappingBefore);
    }
    assert.equal(fixture.wrapping.loads, wrappingBefore); assert.equal(fixture.approval.calls.length, 0);
    assert.equal(fixture.rpc.sends.length, 0); assert.equal(native.calls.length, 0); assert.equal(x402Rpc.submissions.length, 0);
  }
});

test("concurrent provider-atomic x402 and gasless preparation serialize one global idempotency identity in both orders", { timeout: 15_000 }, async (t) => {
  for (const first of ["gasless", "provider"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const gasless = await gaslessCoreFixture(temporary.root);
    const provider = await providerAtomicFixture(temporary.root, gasless.now);
    const idempotencyKey = `provider-atomic-global-${first}`;
    const idempotencyLock = `operation:idempotency:${gasless.state.idempotencyHash(idempotencyKey)}`;
    const gate = new BoundaryGate(), loserState = new LockObservedState(temporary.root, idempotencyLock);
    const gaslessCore = new ApnCore({ state: first === "gasless" ? gasless.state : loserState,
      gasless: gasless.dependencies, clock: { now: () => new Date(gasless.now) } });
    const providerState = first === "provider" ? provider.state : loserState;
    const providerCore = new ApnCore({ state: providerState, profileRepository: new StateProfileRepository(providerState),
      providerRegistry: provider.registry, providerX402Repository: provider.repository, policy: provider.policy,
      rpc: provider.rpc, http: provider.http, native: provider.native, rpcUrl: provider.rpcUrl,
      clock: { now: () => new Date(provider.now) } });
    const originalSnapshot = gasless.rpc.snapshot.bind(gasless.rpc);
    const originalGet = provider.http.get.bind(provider.http);
    if (first === "gasless") gasless.rpc.snapshot = async (owner) => { await gate.hold(); return await originalSnapshot(owner); };
    else provider.http.get = async (request) => { await gate.hold(); return await originalGet(request); };
    const wrappingBefore = gasless.wrapping.loads;
    const gaslessInput = { command: "gasless.transfer.prepare" as const, profile: gasless.profile,
      request: gasless.request, idempotencyKey };
    const providerInput = { command: "x402.fetch.prepare" as const, profile: provider.profile.profile,
      url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey };
    const winner = first === "gasless" ? gaslessCore.execute(gaslessInput) : providerCore.execute(providerInput);
    await gate.started;
    const loser = first === "gasless" ? providerCore.execute(providerInput) : gaslessCore.execute(gaslessInput);
    await loserState.attempted; gate.release();
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);
    assert.equal(winnerResult.ok, true, winnerResult.error?.message);
    assert.equal(loserResult.error?.code, "APN_IDEMPOTENCY_CONFLICT");
    const gaslessOperations = await gasless.core.gasless.records.listAllOperations();
    const providerOperations = await provider.repository.listAllOperations();
    assert.equal(gaslessOperations.length, first === "gasless" ? 1 : 0);
    assert.equal(providerOperations.length, first === "provider" ? 1 : 0);
    const operations = [...gaslessOperations, ...providerOperations];
    assert.equal(operations.length, 1); assert.equal(operations[0]?.terminal, false);
    assert.equal(operations[0]?.idempotencyHash, gasless.state.idempotencyHash(idempotencyKey));
    assert.equal(operations[0]?.operationId, gasless.state.operationId(
      first === "gasless" ? gasless.profile : provider.profile.profile, idempotencyKey));
    if (first === "gasless") {
      assert.equal(provider.http.calls.length, 0); assert.equal(provider.calls.probe, 0);
      assert.equal(provider.calls.balance, 0); assert.equal(provider.calls.crossCheck, 0); assert.equal(provider.calls.rpcChain, 0);
    } else assert.equal(gasless.rpc.calls.length, 0);
    assert.equal(gasless.wrapping.loads, wrappingBefore); assert.equal(gasless.approval.calls.length, 0);
    assert.equal(gasless.rpc.sends.length, 0); assert.equal(provider.calls.prime, 0); assert.equal(provider.calls.execute, 0);
    assert.equal(provider.rpc.submissions.length, 0); assert.equal(provider.native.calls.length, 0);
  }
});

test("concurrent Solana rail and gasless preparation on different networks both proceed in both orders", { timeout: 15_000 }, async (t) => {
  for (const first of ["gasless", "rail"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const rail = await solanaFixture(temporary.root);
    const gasless = await gaslessProfileFixture(temporary.root, rail.account.profile, rail.now, rail.wrapping);
    const gate = new BoundaryGate(), profileHash = gasless.state.profileHash(gasless.profile);
    const loserState = new LockObservedState(temporary.root, `profile:${profileHash}`);
    const gaslessCore = new ApnCore({ state: first === "gasless" ? gasless.state : loserState,
      gasless: gasless.dependencies, clock: { now: () => new Date(gasless.now) } });
    const railCore = first === "rail" ? rail.core : new ApnCore({ state: loserState, chainAccounts: rail.storage,
      directRails: [rail.adapter], railApproval: rail.approval, chainPolicyApproval: { approve: async () => {} },
      clock: { now: () => new Date(rail.now) } });
    const originalSnapshot = gasless.rpc.snapshot.bind(gasless.rpc);
    const originalPrepare = rail.adapter.prepare.bind(rail.adapter);
    if (first === "gasless") gasless.rpc.snapshot = async (owner) => { await gate.hold(); return await originalSnapshot(owner); };
    else rail.adapter.prepare = async (input) => { await gate.hold(); return await originalPrepare(input); };
    const wrappingBefore = rail.wrapping.loads;
    const gaslessInput = { command: "gasless.transfer.prepare" as const, profile: gasless.profile,
      request: gasless.request, idempotencyKey: `rail-${first}-gasless` };
    const railInput = { command: "transfer.prepare-solana" as const, profile: rail.account.profile, asset: "usdc" as const,
      recipient: SOL_RECIPIENT, amount: "1", maximumFee: "0.003", idempotencyKey: `rail-${first}-solana` };
    const winner = first === "gasless" ? gaslessCore.execute(gaslessInput) : railCore.execute(railInput);
    await gate.started;
    const loser = first === "gasless" ? railCore.execute(railInput) : gaslessCore.execute(gaslessInput);
    await loserState.attempted; gate.release();
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);
    assert.equal(winnerResult.ok, true, winnerResult.error?.message);
    assert.equal(loserResult.ok, true, loserResult.error?.message);
    const gaslessOperations = await gasless.core.gasless.records.listOperations(profileHash);
    const railOperations = await rail.core.rails.records.listOperations(profileHash);
    assert.equal(gaslessOperations.length, 1); assert.equal(railOperations.length, 1);
    for (const operation of [...gaslessOperations, ...railOperations]) assert.equal(operation.terminal, false);
    assert.equal(rail.wrapping.loads, wrappingBefore); assert.equal(rail.approval.calls.length, 0);
    assert.equal(rail.rpc.submissions.length, 0); assert.equal(gasless.rpc.sends.length, 0); assert.equal(gasless.approval.calls.length, 0);
  }
});

test("concurrent LI.FI bridge and gasless preparation on different networks both proceed in both orders", { timeout: 15_000 }, async (t) => {
  for (const first of ["gasless", "bridge"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const bridge = await lifiFixture(temporary.root);
    const quotes = await bridge.core.execute({ command: "bridge.routes", profile: bridge.profile, request: bridge.request });
    assert.equal(quotes.ok, true, quotes.error?.message);
    const quote = (quotes.data as { quote_hash: string }).quote_hash;
    const gasless = await gaslessProfileFixture(temporary.root, bridge.profile, bridge.now, bridge.wrapping,
      { key: LIFI_SYNTHETIC_KEY, initializeWallet: false });
    const gate = new BoundaryGate(), profileHash = gasless.state.profileHash(gasless.profile);
    const loserState = new LockObservedState(temporary.root, `profile:${profileHash}`);
    const gaslessCore = new ApnCore({ state: first === "gasless" ? gasless.state : loserState,
      gasless: gasless.dependencies, clock: { now: () => new Date(gasless.now) } });
    const bridgeCore = first === "bridge" ? bridge.core : new ApnCore({ state: loserState,
      bridge: bridge.dependencies, clock: { now: () => new Date(bridge.now) } });
    const originalSnapshot = gasless.rpc.snapshot.bind(gasless.rpc);
    const originalMaterialize = bridge.provider.materialize.bind(bridge.provider);
    if (first === "gasless") gasless.rpc.snapshot = async (owner) => { await gate.hold(); return await originalSnapshot(owner); };
    else bridge.provider.materialize = async (selected) => { await gate.hold(); return await originalMaterialize(selected); };
    const wrappingBefore = bridge.wrapping.loads;
    assert.notEqual(gasless.request.chainId, bridge.request.fromChainId);
    const gaslessInput = { command: "gasless.transfer.prepare" as const, profile: gasless.profile,
      request: gasless.request, idempotencyKey: `bridge-${first}-gasless` };
    const bridgeInput = { command: "bridge.prepare" as const, profile: bridge.profile, quote,
      route: "route-across", idempotencyKey: `bridge-${first}-lifi` };
    const winner = first === "gasless" ? gaslessCore.execute(gaslessInput) : bridgeCore.execute(bridgeInput);
    await gate.started;
    const loser = first === "gasless" ? bridgeCore.execute(bridgeInput) : gaslessCore.execute(gaslessInput);
    await loserState.attempted; gate.release();
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);
    assert.equal(winnerResult.ok, true, winnerResult.error?.message);
    assert.equal(loserResult.ok, true, loserResult.error?.message);
    const gaslessOperations = await gasless.core.gasless.records.listOperations(profileHash);
    const bridgeOperations = await bridge.core.bridges.records.listOperations(profileHash);
    assert.equal(gaslessOperations.length, 1); assert.equal(bridgeOperations.length, 1);
    for (const operation of [...gaslessOperations, ...bridgeOperations]) assert.equal(operation.terminal, false);
    assert.equal(bridge.wrapping.loads, wrappingBefore); assert.equal(bridge.approval.calls.length, 0);
    assert.equal(bridge.source.submissions.length, 0); assert.equal(bridge.destination.submissions.length, 0);
    assert.equal(gasless.rpc.sends.length, 0); assert.equal(gasless.approval.calls.length, 0);
  }
});

class BoundaryGate {
  private signalStarted!: () => void;
  private signalRelease!: () => void;
  readonly started = new Promise<void>((resolve) => { this.signalStarted = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.signalRelease = resolve; });
  async hold(): Promise<void> { this.signalStarted(); await this.released; }
  release(): void { this.signalRelease(); }
}

class LockObservedState extends StateStore {
  private signalAttempted!: () => void;
  readonly attempted = new Promise<void>((resolve) => { this.signalAttempted = resolve; });
  constructor(root: string, private readonly target: string) { super(root); }
  protected override async beforeLockAcquire(key: string): Promise<void> {
    if (key === this.target) this.signalAttempted();
  }
}

async function gaslessProfileFixture(root: string, profile: string, now: Date, wrapping: WrappingSecretPort, options: {
  readonly key?: Hex; readonly initializeWallet?: boolean;
} = {}) {
  const state = new StateStore(root); await state.initialize();
  const key = options.key ?? generatePrivateKey(), account = privateKeyToAccount(key);
  if (options.initializeWallet !== false) {
    const identity = { profile, address: account.address, chainId: 8453 as const, createdAt: now.toISOString(),
      bindingHash: hashObject({ profile, address: account.address, createdAt: now.toISOString() }) };
    await new EncryptedWalletStore(state, wrapping).save(identity,
      { version: "apn.wallet-secret.v1", privateKey: key, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 73));
    await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile, profileHash: state.profileHash(profile),
      address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash }));
  }
  const rpc = new GaslessTestRpc(8453, account.address, "empty", now), approval = new GaslessApproval();
  const custody = new LocalGaslessCustody(state, wrapping, () => now.getTime());
  const dependencies = { rpcFor: () => rpc, custody, approval };
  const core = new ApnCore({ state, gasless: dependencies, clock: { now: () => new Date(now) } });
  const request = { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic: "10000000",
    maxFeeAtomic: "200000", minReceivedAtomic: "9800000" };
  return { state, profile, now, rpc, approval, custody, dependencies, core, request };
}

async function providerAtomicFixture(root: string, now: Date) {
  const state = new StateStore(root); await state.initialize();
  const capabilities = coinbaseDirectCapabilitySnapshot(), providerId = "coinbase-awal";
  const profile: ProviderProfileRecord = {
    schema_version: "apn.provider-profile.v1", profile: "provider-atomic", profile_hash: state.profileHash("provider-atomic"),
    provider_id: providerId, public_address: "0x1111111111111111111111111111111111111111",
    account_binding_hash: accountBindingHash(providerId, "0x1111111111111111111111111111111111111111"),
    trust_class: "provider_managed_non_custodial_tee", revision: 1, capability_snapshot: capabilities,
    capability_hash: capabilityHash(capabilities), observed_at: now.toISOString(), drift: { state: "bound", reason: "none" },
  };
  await new StateProfileRepository(state).save(profile);
  const calls = { probe: 0, balance: 0, crossCheck: 0, rpcChain: 0, prime: 0, execute: 0 };
  const adapter: ProviderAdapterBundle = {
    provider_id: providerId, trust_class: profile.trust_class, capabilities,
    lifecycle: {
      async connect() { throw new Error("provider connect is forbidden in preparation concurrency tests"); },
      async probeStatus() { calls.probe += 1; },
      async logout() { throw new Error("provider logout is forbidden in preparation concurrency tests"); },
    },
    reads: {
      async observeBalance() { calls.balance += 1; return { address: profile.public_address,
        account_binding_hash: profile.account_binding_hash, chain: "base" as const, asset: "USDC" as const,
        raw: "50000000", formatted: "50 USDC", decimals: 6 as const, observed_at: now.toISOString() }; },
      async crossCheckAddress(expected) { calls.crossCheck += 1; assert.equal(expected, profile.public_address); },
    },
    x402: {
      mode: "provider_atomic_paid_fetch", assertCompatibleIntent() {},
      async prime() { calls.prime += 1; throw new Error("provider prime is forbidden during prepare"); },
      async execute() { calls.execute += 1; throw new Error("provider paid fetch is forbidden during prepare"); },
    },
    evidence: { owner: "apn" },
  };
  const registry = new ProviderRegistry([{ provider_id: providerId, create: () => adapter }]);
  const repository = new ProviderX402Repository(root), policy = new TestProfilePolicy(), rpc = new TestRpc();
  const originalChain = rpc.assertBaseChain.bind(rpc);
  rpc.assertBaseChain = async () => { calls.rpcChain += 1; return await originalChain(); };
  const http = new TestHttp(), native = new TestNative(), rpcUrl = "https://rpc.example";
  return { state, profile, now, calls, registry, repository, policy, rpc, http, native, rpcUrl };
}
