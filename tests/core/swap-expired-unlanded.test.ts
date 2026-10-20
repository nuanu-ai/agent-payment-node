import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { createSwapQuote, type SwapQuoteInput } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { SWAP_MECHANISM_PIN_SCHEMA, type SwapMechanismPin } from "../../src/swap/pin.js";
import { transitionSwapOperation } from "../../src/swap/transitions.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime, sealGuardedSwapApproval, type GuardedSwapExecutionDriver } from "../../src/swap/runtime.js";
import { proveEvmUnlanded, proveSolanaUnlanded, proveTronUnlanded, swapUnlandedProofHash, type SwapUnlandedProof } from "../../src/swap/unlanded.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const H = (c: string) => c.repeat(64);
const NOW = new Date("2026-09-18T00:01:00.000Z");
const SIGNATURE = "99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8";
const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
  chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "owner.sdk", constructorVersion: "1.0.0",
  routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: [], quoteSchemaVersion: "1.0.0",
  transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0" };
const quoteInput: SwapQuoteInput = { profile: "expiry-swap", account: ACCOUNT, recipient: ACCOUNT,
  sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
  inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", providerResponseHash: H("a"),
  routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"), success: true,
    blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } };
const deadline = String(Date.parse(quoteInput.expiresAt) / 1000);
const evmProof: SwapUnlandedProof = { network: "evm", transactionId: `0x${H("9")}`, deadlineSeconds: deadline,
  observedFinalizedBlockNumber: "200", observedFinalizedTimestamp: String(Number(deadline) + 12) };

async function fixture(root: string, prove: () => Promise<SwapUnlandedProof | null>) {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "expiry-swap.1", profile: "expiry-swap",
    account: ACCOUNT, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-19T00:00:00.000Z", admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin },
      { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin },
    ] };
  const policy = compileAllowlistPolicyOverlay(overlay).registry;
  const operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
  const quote = createSwapQuote(structuredClone(quoteInput)), material = { quote, approvalCapAtomic: "0",
    gasOrEnergy: { gasLimit: "100000" }, execution: { unsigned: true } };
  let runtime!: GuardedSwapRuntime<any>, clockMs = NOW.getTime(), observes = 0, proofs = 0;
  const clock = { now: () => new Date(clockMs) };
  const execution: GuardedSwapExecutionDriver = {
    async execute(input) { const op = await runtime.service.markSubmitting(input.operation, input.now);
      return await runtime.service.recordPossibleSend(op, "submitted", input.now); },
    async observe(input) { observes++; return input.operation; },
    async proveUnlanded() { proofs++; return await prove(); },
  };
  runtime = new GuardedSwapRuntime({ chain: "eip155:1", builder: { async quote() { return { quoteHash: quote.quoteHash }; },
    async load(hash) { return hash === quote.quoteHash ? material : null; } },
    policy: async () => policy, clock, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "expiry-swap.1", pins: [pin] }),
    usage, operations, approvals: new GuardedSwapApprovalRepository(root), ownerAdmission: { async assert() {} },
    foregroundApproval: { async approve(intent) { return sealGuardedSwapApproval(intent, clock.now(), H("f")); } }, execution,
    rpc: {}, effectStore: {}, signer: {}, sender: {}, observer: {}, caps: { gasLimit: "100000" } });
  const prepared = await runtime.prepare({ profile: "expiry-swap", quoteHash: quote.quoteHash, idempotencyKey: `expiry-swap-${root.length}` }, NOW);
  const sent = await runtime.approveAndExecute(prepared.operationId, NOW);
  const identity = { account: ACCOUNT, chain: "eip155:1", asset: { kind: "native" as const, identifier: null } };
  return { runtime, usage, identity, sent, counters: () => ({ observes, proofs }), advance: (ms: number) => { clockMs += ms; } };
}

test("a marked swap that can never land ends expired_unlanded and releases its daily hold", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root, async () => evmProof);
  assert.equal(f.sent.state, "submitted");
  assert.equal((await f.usage.usage(f.identity, NOW)).amountAtomic, "100");
  f.advance(600_000);
  const expired = await f.runtime.status(f.sent.operationId, NOW);
  assert.equal(expired.state, "expired_unlanded");
  assert.equal(expired.usageLease?.state, "released_unsubmitted");
  assert.equal(expired.failureProofHash, swapUnlandedProofHash(f.sent, evmProof));
  assert.equal(expired.usageLease?.outcomeDigest, expired.failureProofHash);
  assert.equal((await f.usage.usage(f.identity, NOW)).amountAtomic, "0");
  assert.equal(f.runtime.service.resumeDirective(expired), "terminal");
  const again = await f.runtime.execute(f.sent.operationId, NOW);
  assert.equal(again.integrityHash, expired.integrityHash);
  assert.deepEqual(f.counters(), { observes: 1, proofs: 1 });
});

test("an unproven or failing expiry check keeps the hold and the operation observable", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let mode: "null" | "throw" = "null";
  const f = await fixture(temporary.root, async () => { if (mode === "throw") throw new Error("rpc down"); return null; });
  assert.equal((await f.runtime.status(f.sent.operationId, NOW)).state, "submitted");
  mode = "throw";
  assert.equal((await f.runtime.status(f.sent.operationId, NOW)).state, "submitted");
  assert.equal((await f.usage.usage(f.identity, NOW)).amountAtomic, "100");
});

test("a crash after the lease release completes on the next status with the same digest", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root, async () => ({ ...evmProof, observedFinalizedBlockNumber: "300" }));
  const marked = await f.runtime.service.recordPossibleSend(f.sent, "unknown_finality", NOW);
  await f.usage.transition({ ...f.identity, reservationId: marked.usageLease!.reservationId, policyDigest: marked.policyDigest,
    state: "released_unsubmitted", now: NOW, outcomeDigest: swapUnlandedProofHash(marked, evmProof) });
  const expired = await f.runtime.status(f.sent.operationId, NOW);
  assert.equal(expired.state, "expired_unlanded");
});

test("the terminal transition refuses a receipt-bearing operation and a lease bound to another proof", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture(temporary.root, async () => null);
  const marked = await f.runtime.service.recordPossibleSend(f.sent, "unknown_finality", NOW);
  const digest = swapUnlandedProofHash(marked, evmProof), released = { ...marked.usageLease!, state: "released_unsubmitted" as const,
    outcomeDigest: digest };
  assert.throws(() => transitionSwapOperation(marked, "expired_unlanded", { usageLease: released, failureProofHash: H("7") }, NOW),
    { code: "APN_INVALID_INPUT" });
  assert.throws(() => transitionSwapOperation(f.sent, "finalized", { usageLease: released, failureProofHash: digest }, NOW),
    { code: "APN_INVALID_INPUT" });
  await assert.rejects(f.runtime.service.expireUnlanded({ ...marked }, NOW, { ...evmProof, network: "solana" } as never),
    { code: "APN_INVALID_INPUT" });
});

test("Solana proof needs the finalized height past the lifetime and no status for a persisted signature", async () => {
  const reads: string[] = [];
  const rpc = (height: bigint, status: unknown) => ({ async call(method: string) { reads.push(method);
    return method === "getBlockHeight" ? height : method === "getLatestBlockhash"
      ? { context: { slot: 10n }, value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: height + 150n } }
      : { context: { slot: 10n }, value: [status] }; } });
  assert.equal(await proveSolanaUnlanded(rpc(100n, null), { lastValidBlockHeight: "100", loadSignature: async () => SIGNATURE }), null);
  assert.deepEqual(reads.splice(0), ["getBlockHeight", "getLatestBlockhash"]);
  assert.equal(await proveSolanaUnlanded(rpc(101n, { slot: 5n }), { lastValidBlockHeight: "100", loadSignature: async () => SIGNATURE }), null);
  const proof = await proveSolanaUnlanded(rpc(101n, null), { lastValidBlockHeight: "100", loadSignature: async () => SIGNATURE });
  assert.deepEqual(proof, { network: "solana", transactionId: SIGNATURE, lastValidBlockHeight: "100", observedFinalizedBlockHeight: "101" });
  reads.splice(0);
  const unsigned = await proveSolanaUnlanded(rpc(101n, null), { lastValidBlockHeight: "100", loadSignature: async () => null });
  assert.equal(unsigned?.transactionId, null); assert.deepEqual(reads, ["getBlockHeight", "getLatestBlockhash"]);
});

test("EVM proof needs chain 1, a finalized timestamp past the deadline and no receipt", async () => {
  const call = (chain: string, timestamp: number, receipt: unknown) => async (method: string) => method === "eth_chainId" ? chain :
    method === "eth_getBlockByNumber" ? { number: "0xc8", hash: `0x${H("a")}`, timestamp: `0x${timestamp.toString(16)}` } : receipt;
  const input = { chainId: 1n, deadlineSeconds: 1_000, loadTransactionHash: async () => `0x${H("9")}` };
  await assert.rejects(proveEvmUnlanded(call("0x2", 2_000, null), input), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(await proveEvmUnlanded(call("0x1", 1_000, null), input), null);
  assert.equal(await proveEvmUnlanded(call("0x1", 1_001, { status: "0x1" }), input), null);
  assert.deepEqual(await proveEvmUnlanded(call("0x1", 1_001, null), input), { network: "evm", transactionId: `0x${H("9")}`,
    deadlineSeconds: "1000", observedFinalizedBlockNumber: "200", observedFinalizedTimestamp: "1001" });
});

test("TRON proof needs the solidified head past the expiration and no solidified record", async () => {
  const rpc = (timestamp: number, present: boolean) => ({ async call(method: string) {
    return method === "walletsolidity/getnowblock" ? { block_header: { raw_data: { number: 77, timestamp } } } : present ? { id: H("1") } : {}; } });
  const input = { transactionId: H("1"), expirationMs: "5000" };
  assert.equal(await proveTronUnlanded(rpc(5_000, false), input), null);
  assert.equal(await proveTronUnlanded(rpc(5_001, true), input), null);
  assert.deepEqual(await proveTronUnlanded(rpc(5_001, false), input), { network: "tron", transactionId: H("1"), expirationMs: "5000",
    observedSolidifiedBlockNumber: "77", observedSolidifiedTimestampMs: "5001" });
});
