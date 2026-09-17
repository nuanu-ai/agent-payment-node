import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { utils } from "tronweb";
import {
  AssetUsageLedger, GuardedSwapService, SUNSWAP_NATIVE_TRX, SUNSWAP_PERMIT2,
  SUNSWAP_TRON_CHAIN, SUNSWAP_USDT, SUNSWAP_V4_POOL_MANAGER, SUNSWAP_V4_UNIVERSAL_ROUTER,
  SWAP_MECHANISM_PIN_SCHEMA, SunSwapGuardedExecutor, SunSwapProtectedExecutionAdapter,
  SunSwapSolidifiedObserver, SwapOperationRepository, buildSunSwapUnsignedTransaction,
  compileAllowlistPolicyOverlay, compileSwapProtocolRegistry, createSunSwapQuoteSnapshot, decodeSunSwapQuote,
  encodeSunSwapCalldata, loadAllowlistInventory, observeSunSwapFinality, sealAssetPolicyRegistry,
  sealSunSwapForegroundApproval, sunSwapUnsignedPayloadHash, validateSunSwapExecutionBinding,
  validateSunSwapSignedTransaction, type AllowlistPolicyOverlayInput,
  type SunSwapExecutionBinding, type SunSwapForegroundApprovalInput, type SunSwapObservationMethod,
  type SunSwapObservationRpcPort, type SwapChainObserverPort, type SwapMechanismPin,
  type SwapOperationRecord,
} from "../../src/core.js";
import { sha256 } from "../../src/canonical.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { SunSwapBroadcastRpcPort } from "../../src/swap/sunswap-tron/signer.js";
import { tronHex } from "../../src/tron/codec.js";
import { temporaryState } from "./helpers.js";

const SEED = Buffer.alloc(32, 19);
const OWNER = utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey([...SEED]));
const RECIPIENT = utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey(Array(32).fill(48)));
const HASH = "000000000000007b" + "1".repeat(48);
const NOW = new Date("2026-09-17T00:01:00.000Z");

class Wrapping implements WrappingSecretPort {
  value = Buffer.alloc(32, 73);
  async load(): Promise<Buffer | null> { return Buffer.from(this.value); }
  async create(): Promise<Buffer> { return Buffer.from(this.value); }
}

const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "sunswap_tron", networkFamily: "tron",
  chain: SUNSWAP_TRON_CHAIN, protocolVersion: "4.0.0", constructorKind: "builder_api", constructorIdentity: "open.sun.io.apiv2",
  constructorVersion: "2.0.0", routerProgramIdentity: SUNSWAP_V4_UNIVERSAL_ROUTER,
  auxiliaryContractProgramIdentities: [SUNSWAP_V4_POOL_MANAGER, SUNSWAP_PERMIT2], quoteSchemaVersion: "2.0.0",
  transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "apn.sunswap.direct-native-input",
  validationPolicyVersion: "1.0.0" };

function route() {
  return decodeSunSwapQuote({ code: 0, message: "SUCCESS", data: [{ roadForAddr: [SUNSWAP_NATIVE_TRX, SUNSWAP_USDT],
    roadForName: ["TRX", "USDT"], pool: ["v2"], amount: "0.345678", inUsd: "1.0", outUsd: "0.345678",
    impact: "-0.001", fee: "0.003" }] }, "1000000")[0]!;
}

async function fixture(root: string) {
  const wrapping = new Wrapping();
  const storage = new ChainAccountStore(root, wrapping);
  const account = await storage.ensureLocal({ profile: "sunswap", rail: "tron",
    create: async () => ({ address: OWNER, seed: Buffer.from(SEED) }) });
  const intent = { owner: OWNER, recipient: RECIPIENT, inputAmountAtomic: "1000000", minimumOutputAtomic: "300000",
    deadlineSeconds: "1789603500", calldata: "", callValueAtomic: "1000000", referenceBlockId: HASH,
    timestampMs: "1789603200000", expirationMs: "1789603500000", feeLimitSun: "100000000",
    maximumEnergy: "100000", energyPriceSun: "100", maximumFeeLimitSun: "100000000" };
  intent.calldata = encodeSunSwapCalldata({ owner: intent.owner, recipient: intent.recipient,
    inputAmountAtomic: intent.inputAmountAtomic, minimumOutputAtomic: intent.minimumOutputAtomic,
    deadlineSeconds: intent.deadlineSeconds });
  const transaction = buildSunSwapUnsignedTransaction(intent);
  const simulation = { requestHash: "c".repeat(64), resultHash: "d".repeat(64), success: true as const,
    energyRequired: "50000", feeLimitSun: intent.feeLimitSun, blockNumber: "123", blockHash: `0x${HASH}`,
    headBlockNumber: "123", maxHeadDrift: 0, gasEstimate: "50000" };
  const quote = createSunSwapQuoteSnapshot({ profile: "sunswap", account: OWNER, recipient: RECIPIENT,
    inputAmountAtomic: "1000000", minimumOutputAtomic: "300000", slippageBps: 2000,
    effectiveAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-09-17T00:05:00.000Z",
    providerResponseHash: "a".repeat(64), unsignedTransactionPayloadHash: sunSwapUnsignedPayloadHash(transaction), route: route(),
    simulation: { requestHash: simulation.requestHash, resultHash: simulation.resultHash, success: true,
      blockNumber: simulation.blockNumber, blockHash: simulation.blockHash, headBlockNumber: simulation.headBlockNumber,
      maxHeadDrift: simulation.maxHeadDrift, gasEstimate: simulation.gasEstimate } });
  const inventory = loadAllowlistInventory();
  const overlay: AllowlistPolicyOverlayInput = { overlayVersion: "sunswap-owner.1", profile: "sunswap", account: OWNER,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-09-18T00:00:00.000Z", admissions: [
      { chain: SUNSWAP_TRON_CHAIN, kind: "native", rail: "swap", maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000", mechanism: pin },
      { chain: SUNSWAP_TRON_CHAIN, kind: "token", identifier: SUNSWAP_USDT, rail: "swap", maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000", mechanism: pin },
    ] };
  const compiled = compileAllowlistPolicyOverlay(overlay).registry;
  const policy = sealAssetPolicyRegistry({ schemaVersion: compiled.schemaVersion, registryVersion: compiled.registryVersion,
    publishedAt: compiled.publishedAt, effectiveDate: compiled.effectiveDate, effectiveAt: compiled.effectiveAt!, expiresAt: compiled.expiresAt!,
    chains: compiled.chains.map((chain) => ({ ...chain, assets: chain.assets.map((asset) =>
      ({ ...asset, rails: { ...asset.rails, direct: true } })) })) });
  const protocols = compileSwapProtocolRegistry({ registryVersion: "sunswap.1", pins: [pin] });
  const operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
  const service = new GuardedSwapService(operations, usage);
  const operation = await service.prepare({ quote: stripQuote(quote), assetPolicy: policy, protocolRegistry: protocols,
    idempotencyKey: `sunswap-execution-${sha256(root).slice(0, 16)}`, approvalCapAtomic: "0", now: NOW });
  const binding: SunSwapExecutionBinding = { account, intent, transaction, simulation };
  return { wrapping, storage, account, policy, protocols, operations, usage, service, operation, binding };
}

function stripQuote(quote: ReturnType<typeof createSunSwapQuoteSnapshot>) {
  const { schemaVersion: _schema, profileHash: _profile, quoteHash: _hash, ...input } = quote; return input;
}

class Broadcast implements SunSwapBroadcastRpcPort {
  calls = 0; ambiguous = false; before?: () => Promise<void>;
  constructor(readonly txid: string) {}
  async call(): Promise<unknown> { this.calls++; await this.before?.(); if (this.ambiguous) throw new Error("lost"); return { result: true, txid: this.txid }; }
}

function approval(input: SunSwapForegroundApprovalInput) { return sealSunSwapForegroundApproval(input, NOW); }
function receiptFixture(binding: SunSwapExecutionBinding, output = "300001", solid = "124") {
  const topic = tronHex(RECIPIENT).slice(2).padStart(64, "0");
  const transaction = { txID: binding.transaction.txID, raw_data_hex: binding.transaction.raw_data_hex, ret: [{ contractRet: "SUCCESS" }] };
  const info = { id: binding.transaction.txID, blockNumber: "123", fee: "12345", receipt: { result: "SUCCESS" }, log: [{
    address: tronHex(SUNSWAP_USDT).slice(2), topics: ["ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0".repeat(64), topic], data: BigInt(output).toString(16).padStart(64, "0") }] };
  return { transaction, info, head: { block_header: { raw_data: { number: solid } } } };
}
class ObservationRpc implements SunSwapObservationRpcPort {
  conflict = false; missing = false; calls: SunSwapObservationMethod[] = [];
  constructor(readonly fixture: ReturnType<typeof receiptFixture>) {}
  async call(method: SunSwapObservationMethod): Promise<unknown> {
    this.calls.push(method); if (this.missing && method === "wallet/gettransactionbyid") return {};
    if (method === "walletsolidity/getnowblock") return this.fixture.head;
    if (method.endsWith("gettransactionbyid")) return this.fixture.transaction;
    if (this.conflict && method === "walletsolidity/gettransactioninfobyid") {
      return { ...this.fixture.info, fee: "12346" };
    }
    return this.fixture.info;
  }
}

test("protected signer binds exact owner/tx/TAPOS/expiry/fee/simulation and survives restart without public signed bytes", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  const reserved = await f.service.reserve(f.operation, f.policy, NOW);
  const rpc = new Broadcast(f.binding.transaction.txID);
  const adapter = new SunSwapProtectedExecutionAdapter(f.storage, rpc, f.operation, f.binding);
  const handle = await adapter.sign(reserved); assert.match(handle.signedMaterialHandle, /^[a-f0-9]{64}$/u);
  const publicBytes = await readFile(join(temp.root, "swap-operations", reserved.ownerProfileHash, `${reserved.operationId}.json`), "utf8");
  assert.equal(publicBytes.includes("signature"), false); assert.equal(publicBytes.includes(SEED.toString("hex")), false);
  const restarted = new SunSwapProtectedExecutionAdapter(new ChainAccountStore(temp.root, f.wrapping), rpc, f.operation, f.binding);
  assert.deepEqual(await restarted.recover(), handle);
  const signed = await f.storage.effect(f.account, reserved.operationId, handle.signedMaterialHandle); assert.ok(signed);
  const parsed: any = JSON.parse(signed.rawPayload); parsed.signature.push(parsed.signature[0]);
  assert.throws(() => validateSunSwapSignedTransaction(parsed, f.binding.transaction, OWNER), { code: "APN_WALLET_MISMATCH" });
  for (const mutate of [
    (b: any) => { b.transaction.raw_data.fee_limit--; }, (b: any) => { b.transaction.raw_data.expiration++; },
    (b: any) => { b.transaction.raw_data.ref_block_hash = "0".repeat(16); }, (b: any) => { b.transaction.raw_data.contract[0].parameter.value.call_value++; },
    (b: any) => { b.simulation.resultHash = "e".repeat(64); }, (b: any) => { b.intent.maximumEnergy = "49999"; },
  ]) { const bad: any = structuredClone(f.binding); mutate(bad);
    assert.throws(() => validateSunSwapExecutionBinding(f.operation, bad), { code: "APN_WALLET_MISMATCH" }); }
  const walletPath = join(temp.root, "chain-wallets", "tron", `${f.account.profileHash}.json`);
  const envelope = JSON.parse(await readFile(walletPath, "utf8")); envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
  await writeFile(walletPath, JSON.stringify(envelope));
  await assert.rejects(restarted.recover(), { code: "APN_STATE_CORRUPT" });
});

test("executor persists marker before one ambiguous broadcast and restart is observation-only", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  const broadcast = new Broadcast(f.binding.transaction.txID); broadcast.ambiguous = true;
  broadcast.before = async () => { const saved = await f.operations.load(f.operation.ownerProfileHash, f.operation.operationId);
    assert.equal(saved?.state, "submitting"); assert.ok(saved?.submissionMarker); };
  const protectedAdapter = new SunSwapProtectedExecutionAdapter(f.storage, broadcast, f.operation, f.binding);
  const observer: SwapChainObserverPort = { observe: async () => { throw new Error("missing"); } };
  const deps = { service: f.service, policy: f.policy, protocolRegistry: f.protocols,
    ownerAdmission: { admit: async () => ({ admitted: true as const, accountIdentityHash: f.account.identityHash }) },
    approval: { approve: async (input: SunSwapForegroundApprovalInput) => approval(input) },
    resourceFeeCap: { maximumEnergy: "100000", energyPriceSun: "100", maximumFeeLimitSun: "100000000" },
    signer: protectedAdapter, sender: protectedAdapter, observer };
  const unknown = await new SunSwapGuardedExecutor(deps, f.binding).execute(f.operation, NOW);
  assert.equal(unknown.state, "unknown_finality"); assert.equal(unknown.usageLease?.state, "unknown_finality"); assert.equal(broadcast.calls, 1);
  const noResend = new Broadcast(f.binding.transaction.txID);
  const restartedAdapter = new SunSwapProtectedExecutionAdapter(new ChainAccountStore(temp.root, f.wrapping), noResend, f.operation, f.binding);
  const restartedService = new GuardedSwapService(new SwapOperationRepository(temp.root), new AssetUsageLedger(temp.root));
  const resumed = await new SunSwapGuardedExecutor({ ...deps, service: restartedService, signer: restartedAdapter, sender: restartedAdapter }, f.binding)
    .resume(unknown, new Date("2026-09-17T00:01:01.000Z"));
  assert.equal(resumed.state, "unknown_finality"); assert.equal(noResend.calls, 0);
});

test("observer requires matching full and solidified router transaction, output and fee proof", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  const expected = { transactionHash: f.binding.transaction.txID, recipient: RECIPIENT, minimumOutputAtomic: "300000",
    unsignedRawDataHex: f.binding.transaction.raw_data_hex, maximumFeeSun: "100000000" };
  const rpc = new ObservationRpc(receiptFixture(f.binding));
  const proof = await observeSunSwapFinality(rpc, expected); assert.equal(proof.outputAmountAtomic, "300001"); assert.equal(proof.finalized, true);
  assert.deepEqual(rpc.calls, ["wallet/gettransactionbyid", "wallet/gettransactioninfobyid", "walletsolidity/gettransactionbyid",
    "walletsolidity/gettransactioninfobyid", "walletsolidity/getnowblock"]);
  rpc.conflict = true; await assert.rejects(observeSunSwapFinality(rpc, expected), { code: "APN_RPC_PROTOCOL" });
  rpc.conflict = false; rpc.missing = true; await assert.rejects(observeSunSwapFinality(rpc, expected), { code: "APN_RPC_PROTOCOL" });
});

test("explicit admission, cross-rail cap, fee cap and exact foreground approval fail before signing", async (t) => {
  const cases = ["admission", "approval", "fee", "usage"] as const;
  for (const kind of cases) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root); let signs = 0;
    if (kind === "usage") await f.usage.reserve({ account: OWNER, chain: SUNSWAP_TRON_CHAIN, asset: { kind: "native", identifier: null },
      registry: f.policy, rail: "direct", amountAtomic: "1", idempotencyKey: "existing-direct-use", now: NOW });
    const signer = { sign: async () => { signs++; return { signedMaterialHandle: "f".repeat(64) }; } };
    const observer = new SunSwapSolidifiedObserver(new ObservationRpc(receiptFixture(f.binding)), f.operation, f.binding, "100000000", () => NOW);
    const executor = new SunSwapGuardedExecutor({ service: f.service, policy: f.policy, protocolRegistry: f.protocols,
      ownerAdmission: { admit: async () => kind === "admission" ? { admitted: true as const, accountIdentityHash: "0".repeat(64) } :
        { admitted: true as const, accountIdentityHash: f.account.identityHash } },
      approval: { approve: async (input: SunSwapForegroundApprovalInput) => {
        const sealed: any = approval(input); if (kind === "approval") sealed.minimumOutputAtomic = "299999"; return sealed; } },
      resourceFeeCap: kind === "fee" ? { maximumEnergy: "99999", energyPriceSun: "100", maximumFeeLimitSun: "100000000" } :
        { maximumEnergy: "100000", energyPriceSun: "100", maximumFeeLimitSun: "100000000" },
      signer, sender: { sendOnce: async () => ({ transactionHash: f.binding.transaction.txID }) }, observer }, f.binding);
    await assert.rejects(executor.execute(f.operation, NOW), { code: "APN_OPERATION_BLOCKED" }); assert.equal(signs, 0);
  }
});

test("successful execution finalizes exact solidified receipt with no token approval", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await fixture(temp.root);
  const broadcast = new Broadcast(f.binding.transaction.txID);
  const protectedAdapter = new SunSwapProtectedExecutionAdapter(f.storage, broadcast, f.operation, f.binding);
  const observer = new SunSwapSolidifiedObserver(new ObservationRpc(receiptFixture(f.binding)), f.operation, f.binding,
    "100000000", () => NOW);
  const executor = new SunSwapGuardedExecutor({ service: f.service, policy: f.policy, protocolRegistry: f.protocols,
    ownerAdmission: { admit: async () => ({ admitted: true as const, accountIdentityHash: f.account.identityHash }) },
    approval: { approve: async (input: SunSwapForegroundApprovalInput) => approval(input) },
    resourceFeeCap: { maximumEnergy: "100000", energyPriceSun: "100", maximumFeeLimitSun: "100000000" },
    signer: protectedAdapter, sender: protectedAdapter, observer }, f.binding);
  const final = await executor.execute(f.operation, NOW);
  assert.equal(final.state, "finalized"); assert.equal(final.approvalCapAtomic, "0"); assert.equal(final.receiptProof?.transactionHash, f.binding.transaction.txID);
  assert.equal(broadcast.calls, 1);
});
