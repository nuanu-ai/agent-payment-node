import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { getAddress } from "viem";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { validateRelayNativeQuote, RELAY_BASE_SOURCE, RELAY_BNB_SOURCE } from "../../src/relay/native-quote.js";
import { proveRelayNativeDestination, type RelayBnbProofPorts, type RelayBnbRecipientCreditEvidence } from "../../src/relay/destination-proof.js";
import { RelayDestinationClaimRepository } from "../../src/relay/destination-claim.js";
import { decodeRelayBaseReceiptFee, verifyRelayBaseReceiptFee } from "../../src/relay/source-fee-proof.js";
import { verifyRelayNativeSourceObservation, RelayNativeObserveService } from "../../src/relay/native-observe.js";
import { RelayBnbReadOnlyRpc } from "../../src/relay/observe-rpc.js";
import type { HttpsBaseRpc } from "../../src/rpc.js";
import type { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { RelayNativeSourceJournalRepository } from "../../src/relay/native-source.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
const hash = (c: string) => `0x${c.repeat(64)}`;
async function operation(state: StateStore) {
  const quote = await validateRelayNativeQuote(JSON.parse(await readFile("tests/core/relay-fixtures/relay-base-polygon-pol-quote-20261009.json", "utf8")),
    { payer: RELAY_BASE_SOURCE, recipient: RELAY_BNB_SOURCE, amountAtomic: "50000000000000", minimumOutputWei: "700000000000000000", nowSeconds: 1791517419 });
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned", state: "prepared", terminal: false,
    profileHash: state.profileHash("evm-live-seller"), operationId: "2".repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64),
    sourceChainId: 8453, destinationChainId: 137, sourceAccount: quote.payer, recipient: quote.recipient,
    quoteDigest: quote.quoteDigest, nativeQuote: quote, statusLocator: quote.statusLocator!, policyDigest: "5".repeat(64), policyRevision: 1,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: quote.principalAtomic, minOutputAtomic: quote.minimumOutputWei,
    createdAt: new Date(1791517419000).toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
}
test("Base receipt includes L1 and Jovian operator fees with strict quantity/data codecs", () => {
  const raw = { gasUsed: "0x64", effectiveGasPrice: "0xa", l1Fee: "0x14", daFootprintGasScalar: "0x1", operatorFeeScalar: "0x2", operatorFeeConstant: "0x3" };
  const fee = decodeRelayBaseReceiptFee(raw);
  assert.deepEqual(fee, { l2ExecutionFeeWei: "1000", l1FeeWei: "20", operatorFeeWei: "20003", totalFeeWei: "21023" });
  verifyRelayBaseReceiptFee(fee, "21023");
  assert.throws(() => verifyRelayBaseReceiptFee(fee, "21022"));
  for (const changed of [{ l1Fee: undefined }, { l1Fee: "0x00" }, { gasUsed: "0x064" }, { operatorFeeScalar: "0x00000002" }, { operatorFeeScalar: "0x100000000" }, { daFootprintGasScalar: undefined }, { operatorFeeConstant: undefined }, { operatorFee: "0x1" }])
    assert.throws(() => decodeRelayBaseReceiptFee({ ...raw, ...changed }));
  assert.equal(decodeRelayBaseReceiptFee({ gasUsed: "0x1", effectiveGasPrice: "0x1", l1Fee: "0x0", daFootprintGasScalar: "0x1" }).totalFeeWei, "1");
  assert.throws(() => verifyRelayBaseReceiptFee(undefined, "1000000000000"));
});
test("finite Base source refuses missing or over-ceiling complete receipt fee", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const op = await operation(new StateStore(tmp.root));
  const observation = { transaction: { hash: hash("a"), from: op.sourceAccount, to: op.nativeQuote!.deposit.to,
    input: op.nativeQuote!.deposit.data, value: BigInt(op.amountAtomic), chainId: 8453 }, receipt: { transactionHash: hash("a"), status: "success" as const,
    blockNumber: 100n, blockHash: hash("b") }, canonicalBlockHash: hash("b") };
  assert.throws(() => verifyRelayNativeSourceObservation(op, hash("a"), observation));
  const fee = decodeRelayBaseReceiptFee({ gasUsed: "0x1", effectiveGasPrice: "0x1", l1Fee: "0x0", daFootprintGasScalar: "0x1" });
  assert.equal(verifyRelayNativeSourceObservation(op, hash("a"), { ...observation, receipt: { ...observation.receipt, actualFee: fee } }), "confirmed");
});
test("Base Polygon requires milestone finalized port and rejects checkpoint reorg", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const op = await operation(new StateStore(tmp.root));
  const ports: RelayBnbProofPorts = { chainId: async () => 137,
    transaction: async () => ({ hash: hash("c"), chainId: 137, to: op.recipient, valueWei: BigInt(op.minOutputAtomic), blockNumber: 100n, blockHash: hash("b") }),
    receipt: async () => ({ transactionHash: hash("c"), status: "success", blockNumber: 100n, blockHash: hash("b") }),
    block: async number => ({ number, hash: number === 100n ? hash("b") : hash("d") }),
    finalityCheckpoint: async () => ({ number: 115n, hash: hash("d") }), nativeTrace: async () => null };
  assert.equal((await proveRelayNativeDestination(op, hash("a"), [hash("c")], ports)).status, "unproven");
  const strict = { ...ports, polygonFinalizedCheckpoint: async () => ({ number: 115n, hash: hash("d") }) };
  const proof = await proveRelayNativeDestination(op, hash("a"), [hash("c")], strict);
  assert.equal(proof.status, "recipient_credit_proven");
  if (proof.status === "recipient_credit_proven") assert.equal(proof.proof.finalityKind, "polygon_milestone_finalized");
  assert.equal((await proveRelayNativeDestination(op, hash("a"), [hash("c")], { ...strict, polygonFinalizedCheckpoint: async () => ({ number: 115n, hash: hash("e") }) })).status, "mismatch");
  assert.equal((await proveRelayNativeDestination(op, hash("a"), [hash("c")], { ...strict, polygonFinalizedCheckpoint: async () => ({ number: 99n, hash: hash("d") }) })).status, "pending");
});
test("permanent payout claim survives new repository/recovery and rejects another intent", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const op = await operation(new StateStore(tmp.root));
  const proof: RelayBnbRecipientCreditEvidence = { operationId: op.operationId, operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest,
    orderId: op.nativeQuote!.orderId, sourceDepositHash: hash("a"), destinationTransactionHash: hash("c"), destinationBlockNumber: "100", destinationBlockHash: hash("b"),
    finalityBlockNumber: "115", finalityBlockHash: hash("d"), finalityKind: "polygon_milestone_finalized", recipient: op.recipient.toLowerCase(),
    minimumOutputWei: op.minOutputAtomic, creditedWei: op.minOutputAtomic, method: "direct_native_transaction" };
  const sourceJournal = new RelayNativeSourceJournalRepository(tmp.root);
  let journal = await sourceJournal.advance(op, null, "pending");
  journal = await sourceJournal.advance(op, journal.integrityHash, "signing_started");
  journal = await sourceJournal.advance(op, journal.integrityHash, "sealed", hash("a"));
  journal = await sourceJournal.advance(op, journal.integrityHash, "submitting");
  await sourceJournal.advance(op, journal.integrityHash, "confirmed");
  class InterruptedClaim extends RelayDestinationClaimRepository {
    protected override async writeJson(path: string, value: unknown, createOnly = false): Promise<void> {
      await super.writeJson(path, value, createOnly); throw new Error("crash after durable claim before acceptance");
    }
  }
  await assert.rejects(new InterruptedClaim(tmp.root).claim(op, hash("a"), proof), /crash after durable claim/);
  const files = await readdir(join(tmp.root, "relay-destination-payout-claims")); assert.equal(files.length, 1);
  const path = join(tmp.root, "relay-destination-payout-claims", files[0]!); const before = await readFile(path, "utf8");
  await new RelayDestinationClaimRepository(tmp.root).claim(op, hash("a"), proof);
  assert.equal(await readFile(path, "utf8"), before);
  const { integrityHash: _integrity, ...otherFields } = op;
  const other = freezeRelayUnsignedOperation({ ...otherFields, operationId: "9".repeat(64) });
  await assert.rejects(new RelayDestinationClaimRepository(tmp.root).claim(other, hash("a"), { ...proof, operationId: other.operationId, operationIntegrityHash: other.integrityHash }));
  let otherJournal = await sourceJournal.advance(other, null, "pending");
  otherJournal = await sourceJournal.advance(other, otherJournal.integrityHash, "signing_started");
  otherJournal = await sourceJournal.advance(other, otherJournal.integrityHash, "sealed", hash("a"));
  otherJournal = await sourceJournal.advance(other, otherJournal.integrityHash, "submitting");
  await sourceJournal.advance(other, otherJournal.integrityHash, "confirmed");
  await assert.rejects(new RelayDestinationClaimRepository(tmp.root).claim(other, hash("a"), { ...proof, operationId: other.operationId, operationIntegrityHash: other.integrityHash }));
  await assert.rejects(new RelayDestinationClaimRepository(tmp.root).claim(op, "", proof));
  assert.equal(await readFile(path, "utf8"), before);
});

test("Polygon RPC uses finalized tag without latest-minus-depth fallback", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const calls: unknown[] = [];
  const rpc = { batchCall: async (batch: unknown[]) => { calls.push(batch); return [{ number: "0x64", hash: hash("b") }]; } } as unknown as HttpsBaseRpc;
  const guard = { post: async (_url: string, read: () => Promise<unknown>) => read() } as unknown as EvmDirectRpcGuard;
  const ports = new RelayBnbReadOnlyRpc("https://example.com", new StateStore(tmp.root), rpc, guard, 137);
  assert.deepEqual(await ports.polygonFinalizedCheckpoint(), { number: 100n, hash: hash("b") });
  assert.deepEqual(calls, [[{ method: "eth_getBlockByNumber", params: ["finalized", false] }]]);
});

test("Base operational acceptance requires canonical source, bound status, full fees and unique claim", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const state = new StateStore(tmp.root), initial = await operation(state), now = new Date(initial.createdAt);
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "relay-proof.test.1", publishedAt: initial.createdAt,
    effectiveDate: initial.createdAt.slice(0, 10), effectiveAt: initial.createdAt, chains: [{ chain: "eip155:8453", family: "evm", name: "Base", assets: [{ kind: "native", identifier: null,
      symbol: "ETH", decimals: 18, rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: initial.amountAtomic, dailyLimitAtomic: initial.amountAtomic } },
      mechanismPins: { bridge: { provider: "relay", reference: initial.nativeQuote!.routeReference } } }] }] });
  const { integrityHash: _, ...fields } = initial; const op = freezeRelayUnsignedOperation({ ...fields, policyDigest: registry.policyDigest });
  await new RelayUnsignedOperationRepository(tmp.root).persistLocked(op);
  const wallet = { schemaVersion: "apn.state.v1" as const, profile: "evm-live-seller" as const, profileHash: op.profileHash, address: op.sourceAccount as `0x${string}`,
    createdAt: initial.createdAt, bindingHash: hashObject({ profile: "evm-live-seller", address: op.sourceAccount, createdAt: initial.createdAt }) };
  await state.writeNewWallet({ ...wallet, integrityHash: hashObject(wallet) });
  await new AssetUsageLedger(tmp.root).reserve({ account: getAddress(op.sourceAccount), chain: "eip155:8453", asset: { kind: "native", identifier: null }, registry,
    rail: "bridge", amountAtomic: op.amountAtomic, idempotencyKey: `relay-native-execute:${op.operationId}`, now });
  const journals = new RelayNativeSourceJournalRepository(tmp.root); let j = await journals.advance(op, null, "pending", null, now);
  j = await journals.advance(op, j.integrityHash, "signing_started", null, now); j = await journals.advance(op, j.integrityHash, "sealed", hash("a"), now);
  await journals.advance(op, j.integrityHash, "submitting", null, now);
  const fee = decodeRelayBaseReceiptFee({ gasUsed: "0x1", effectiveGasPrice: "0x1", l1Fee: "0x2", daFootprintGasScalar: "0x1" });
  let ready = false, bound = false;
  const source = { finalizedDeposit: async () => ready ? { transaction: { hash: hash("a"), from: op.sourceAccount, to: op.nativeQuote!.deposit.to,
    input: op.nativeQuote!.deposit.data, value: BigInt(op.amountAtomic), chainId: 8453 }, receipt: { transactionHash: hash("a"), status: "success" as const,
    blockNumber: 100n, blockHash: hash("b"), actualFee: fee }, canonicalBlockHash: hash("b") } : null };
  const destination = (): RelayBnbProofPorts => ({ chainId: async () => 137, transaction: async () => ({ hash: hash("c"), chainId: 137, to: op.recipient,
    valueWei: BigInt(op.minOutputAtomic), blockNumber: 200n, blockHash: hash("d") }), receipt: async () => ({ transactionHash: hash("c"), status: "success", blockNumber: 200n, blockHash: hash("d") }),
    block: async number => ({ number, hash: number === 200n ? hash("d") : hash("e") }), finalityCheckpoint: async () => null,
    polygonFinalizedCheckpoint: async () => ({ number: 205n, hash: hash("e") }), nativeTrace: async () => null });
  const status = new RelayKeylessStatusService(state, async () => new Response(JSON.stringify({ status: "success", originChainId: 8453, destinationChainId: 137,
    inTxHashes: [bound ? hash("a") : hash("f")], txHashes: [hash("c")] }), { status: 200 }));
  const service = new RelayNativeObserveService(state, source, destination, status, { now: () => now });
  assert.equal((await service.observe(op)).state, "source_unproven");
  ready = true; assert.equal((await service.observe(op)).state, "recipient_credit_observed");
  await assert.rejects(readdir(join(tmp.root, "relay-destination-payout-claims")), { code: "ENOENT" });
  bound = true; const accepted = await service.observe(op); assert.equal(accepted.state, "operational_acceptance"); assert.deepEqual(accepted.sourceActualFee, fee);
  assert.equal((await service.observe(op)).state, "operational_acceptance");
  assert.equal((await readdir(join(tmp.root, "relay-destination-payout-claims"))).length, 1);
});
