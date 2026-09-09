import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../../src/canonical.js";
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
import type { Address } from "../../src/model.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { EVM_REQUEST, evmCore } from "./evm-helpers.js";
import { gaslessFixture as gaslessCoreFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

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
    request: { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic, maxFeeAtomic: "5000000", minReceivedAtomic: "5000000" },
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
      chainId: 8453, recipient: RECIPIENT, grossAtomic, maxFeeAtomic: "5000000", minReceivedAtomic: "5000000",
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
