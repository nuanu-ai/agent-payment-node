import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { swapAdapter } from "../../src/operation-index/adapters/swap.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { abandonSwapOperation } from "../../src/swap/abandon.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { swapRouteOf } from "../../src/swap/route-admission.js";
import { uniswapEconomicsFromReceipt } from "../../src/swap/uniswap-receipt-facts.js";
import { executeUniswapBnbCommand } from "../../src/swap/uniswap-bnb/command-service.js";
import { BNB_UNISWAP_MECHANISM_PIN, BNB_UNISWAP_PROTOCOL_REGISTRY, BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_USDT_WBNB_500, BNB_USDT,
  BNB_WBNB } from "../../src/swap/uniswap-bnb/pins.js";
import { decodeBnbUniswapRouterCalldataFor } from "../../src/swap/uniswap-bnb/router.js";
import { createUniswapBnbRuntime, UniswapBnbReceiptObserver } from "../../src/swap/uniswap-bnb/runtime-factory.js";
import { UniswapEthereumReceiptObserver, UniswapExecutionBindingStore } from "../../src/swap/uniswap-ethereum/execution/index.js";
import type { SwapOperationRecord } from "../../src/swap/model.js";
import { UNISWAP_ROUTER } from "../../src/swap/uniswap-pin.js";
import type { SwapAdmissionMechanism } from "../../src/swap/route-admission.js";
import { temporaryState } from "./helpers.js";
import { BNB_AMOUNT_IN, BnbRpc, bnbPolicy, DEPOSIT_TOPIC, topic, TRANSFER_TOPIC, word } from "./uniswap-bnb-helpers.js";
import { ACCOUNT, MemoryWrapping, PROFILE, keylessWallet } from "./uniswap-keyless-helpers.js";

const noPins = async () => [];
const MINIMUM = "5531408158962074280";
const bindingOf = async (root: string, operation: SwapOperationRecord) => await new UniswapExecutionBindingStore(root).load(operation);
const txHash = (rpc: BnbRpc): Hex => keccak256(rpc.sends[0]!);

async function flow(root: string, options: { readonly typingMs?: number; readonly mechanism?: SwapAdmissionMechanism } = {}) {
  // The terminal consent checks the quote deadline against the wall clock, so the test clock starts now.
  let clockMs = Date.now(); const clock = { now: () => new Date(clockMs) }, start = clock.now();
  const deadline = Math.floor(start.getTime() / 1000) + 900, wrapping = new MemoryWrapping();
  const state = await keylessWallet(root, wrapping, new Date(start.getTime() - 3_600_000));
  const policy = bnbPolicy(start, new Date(deadline * 1000), options.mechanism ?? BNB_UNISWAP_MECHANISM_PIN), rpc = new BnbRpc();
  rpc.timestamp = BigInt(Math.floor(start.getTime() / 1000));
  let printed = "";
  const terminal: NonNullable<TtyTransferApprovalOptions["openTerminal"]> = async () => ({ fd: 11, write: async (text: string) => { printed += text; },
    read: async function* () { clockMs += options.typingMs ?? 0; const code = /Type ([0-9a-f]{6}) and press Enter/u.exec(printed)?.[1] ?? "";
      yield Buffer.from(`${code}\n`); }, close: async () => undefined });
  const runtime = createUniswapBnbRuntime({ state, wrapping, call: rpc.call, verifyPins: noPins, verifySendPins: noPins, clock,
    policy: async (profile) => profile === PROFILE ? policy : null, foreground: "tty", tty: { isTerminal: () => true, openTerminal: terminal } });
  const quoted: any = await runtime.quote({ profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT, outputToken: BNB_USDT, amountAtomic: BNB_AMOUNT_IN,
    slippageBps: 50, ownerSlippageCapBps: 100, deadline, maxGasLimit: "300000", maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000" }, clock.now());
  return { runtime, rpc, state, clock, quoted, printed: () => printed, advance: (ms: number) => { clockMs += ms; },
    usage: async () => (await new AssetUsageLedger(root).usage({ account: ACCOUNT, chain: "eip155:56", asset: { kind: "native", identifier: null } },
      clock.now())).amountAtomic };
}

test("one foreground command shows the exact BNB screen, signs chain 56 to SwapRouter02 and sends exactly once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root, { typingMs: 20_000 });
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "bnb-flow-0001" }, f.clock.now());
  assert.equal(prepared.state, "awaiting_approval"); assert.equal(prepared.approvalCapAtomic, "0");
  assert.equal(prepared.mechanismDigest, swapMechanismDigest(BNB_UNISWAP_MECHANISM_PIN));
  assert.equal(prepared.protocolRegistryDigest, BNB_UNISWAP_PROTOCOL_REGISTRY.registryDigest);
  f.rpc.head = 1001n;
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  assert.equal(sent.state, "submitted"); assert.equal(f.rpc.sends.length, 1);
  for (const line of ["Agent Payment Node guarded swap approval: BNB Smart Chain (eip155:56), Uniswap V3, keyless",
    "You send: 0.01 BNB (10000000000000000 wei), native, exact input",
    "Expected in: 5.559204179861381185 USDT (5559204179861381185 atomic, QuoterV2 at block 1000)",
    `Minimum in: 5.53140815896207428 USDT (${MINIMUM} atomic); the router reverts below this`,
    "Price impact vs pool spot after the 0.05% LP fee: 1 basis points",
    `Pool: ${BNB_UNISWAP_USDT_WBNB_500} (WBNB/USDT, fee tier 500); router: SwapRouter02 ${BNB_UNISWAP_SWAP_ROUTER_02}`,
    "Gas limit: 194069; max fee per gas: 1000000000 wei; max priority fee per gas: 100000000 wei",
    "Maximum network fee: 0.000194069 BNB (194069000000000 wei)",
    "Token approval cap: 0 (native BNB input needs no BEP-20 or Permit2 allowance)", "sends exactly once"]) {
    assert.ok(f.printed().includes(line), line);
  }
  assert.equal(f.printed().includes("ETH"), false, "the BNB screen never names Ethereum's coin");
  const raw = f.rpc.sends[0]!, tx = parseTransaction(raw);
  assert.deepEqual([tx.type, tx.chainId, tx.to, tx.value, tx.nonce, tx.gas, tx.maxFeePerGas, tx.maxPriorityFeePerGas],
    ["eip1559", 56, BNB_UNISWAP_SWAP_ROUTER_02.toLowerCase(), BigInt(BNB_AMOUNT_IN), 3, 194_069n, 1_000_000_000n, 100_000_000n]);
  assert.equal(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized }), ACCOUNT);
  const route = decodeBnbUniswapRouterCalldataFor(tx.data!, { recipient: ACCOUNT, inputAmountAtomic: BNB_AMOUNT_IN, minimumOutputAtomic: MINIMUM,
    deadline: Math.floor(Date.parse(sent.quote.expiresAt) / 1000), outputToken: BNB_USDT });
  assert.equal(route.routeHash, sent.quote.routeHash);
  const again = await f.runtime.execute(sent.operationId, f.clock.now());
  assert.equal(again.state, "submitted"); assert.equal(f.rpc.sends.length, 1, "execute after the marker only observes");
  assert.equal((await f.usage()), BNB_AMOUNT_IN);
  assert.equal(await swapAdapter.runtimeCommand!(sent), "swap.uniswap-bnb.status");
  // A marked BNB swap has a chain-provable outcome (the router deadline), so the owner abandon names its status instead.
  const context = { state: f.state, clock: f.clock, requireOperationAbandonApproval: () => { throw new Error("no consent expected"); } };
  await assert.rejects(abandonSwapOperation(context, sent.operationId), (error: any) => error.details?.reason === "swap_chain_proof_available" &&
    error.details?.nextActions?.[0] === `apn swap bnb uniswap status --operation ${sent.operationId}`);
});

test("a finalized BNB receipt proves the WBNB deposit, the USDT credit and gas; status keeps the exact economics", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "bnb-flow-0002" }, f.clock.now());
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  f.rpc.receipt = "success"; f.rpc.minedAt = 1002n; f.rpc.head = 1003n; f.rpc.credit = 5_540_000_000_000_000_000n; f.advance(2_000);
  const finalized = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(finalized.state, "finalized"); assert.equal(f.rpc.sends.length, 1);
  const economics = { inputAtomic: BNB_AMOUNT_IN, outputAtomic: "5540000000000000000", networkFeeAtomic: "12000000000000", nativeDebitAtomic: "10012000000000000" };
  assert.deepEqual(finalized.receiptProof?.economics, economics);
  assert.equal(await f.usage(), BNB_AMOUNT_IN, "a finalized swap keeps its input charged");
  const context = { uniswapBnbRuntime: f.runtime, state: f.state, clock: f.clock } as never;
  const out = await executeUniswapBnbCommand({ command: "swap.uniswap-bnb.status", operationId: sent.operationId }, context);
  assert.deepEqual(out.receipt, { actualEconomics: economics, actualEconomicsSource: "receipt_proof" });
  // The receipt-facts reader proves the same economics from the receipt alone: WBNB Deposit by the router plus the credit.
  const receipt = await f.rpc.call("eth_getTransactionReceipt", [finalized.receiptProof!.transactionHash]) as Record<string, unknown>;
  assert.deepEqual(uniswapEconomicsFromReceipt(finalized, receipt, { number: "1003" }), economics);
  const logs = receipt.logs as Record<string, unknown>[];
  for (const forged of [{ ...receipt, to: UNISWAP_ROUTER }, { ...receipt, logs: [{ ...logs[0], address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }, logs[1]] },
    { ...receipt, logs: [{ ...logs[0], topics: [DEPOSIT_TOPIC, topic(UNISWAP_ROUTER)] }, logs[1]] },
    { ...receipt, logs: [logs[0], { ...logs[1], data: word(1n) }] }]) {
    assert.throws(() => uniswapEconomicsFromReceipt(finalized, forged, { number: "1003" }), { code: "APN_RPC_PROTOCOL" });
  }
  assert.deepEqual([logs[0]!.address, (logs[1]!.topics as string[])[0]], [BNB_WBNB, TRANSFER_TOPIC]);
});

test("a finalized status-0 BNB receipt releases the reservation, and a pre-send guard refusal releases it unsigned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "bnb-flow-0003" }, f.clock.now());
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  f.rpc.receipt = "revert"; f.rpc.minedAt = 1002n; f.rpc.head = 1003n; f.advance(2_000);
  const reverted = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(reverted.state, "failed_confirmed_revert");
  assert.deepEqual(reverted.receiptProof?.economics, { inputAtomic: "0", outputAtomic: null, networkFeeAtomic: "12000000000000", nativeDebitAtomic: "12000000000000" });
  assert.equal(await f.usage(), "0");

  const other = await temporaryState(); t.after(other.cleanup);
  const pending = await flow(other.root); pending.rpc.pendingNonce = 4n;
  const op = await pending.runtime.prepare({ profile: PROFILE, quoteHash: pending.quoted.quoteHash, idempotencyKey: "bnb-flow-0004" }, pending.clock.now());
  await assert.rejects(pending.runtime.approveAndExecute(op.operationId, pending.clock.now()), (error: any) => error.details?.reason === "uniswap_pending_nonce");
  const released = await new SwapOperationRepository(other.root).loadAny(op.operationId);
  assert.equal(released?.state, "failed_before_effect"); assert.equal(pending.rpc.sends.length, 0); assert.equal(await pending.usage(), "0");

  // BNB blocks are 0.45 s: an approval more than 256 blocks after the quote refuses before signing and needs a new quote.
  const third = await temporaryState(); t.after(third.cleanup);
  const late = await flow(third.root); late.rpc.head = 1257n;
  const stale = await late.runtime.prepare({ profile: PROFILE, quoteHash: late.quoted.quoteHash, idempotencyKey: "bnb-flow-0005" }, late.clock.now());
  await assert.rejects(late.runtime.approveAndExecute(stale.operationId, late.clock.now()), (error: any) => error.details?.reason === "uniswap_execution_drift");
  assert.equal(late.rpc.sends.length, 0);

  // The router deadline passed at a finalized block with no receipt for the signed hash: expired_unlanded, input released.
  const fourth = await temporaryState(); t.after(fourth.cleanup);
  const lost = await flow(fourth.root);
  const lostOp = await lost.runtime.prepare({ profile: PROFILE, quoteHash: lost.quoted.quoteHash, idempotencyKey: "bnb-flow-0008" }, lost.clock.now());
  const unlanded = await lost.runtime.approveAndExecute(lostOp.operationId, lost.clock.now());
  assert.equal(unlanded.state, "submitted"); assert.equal(await lost.usage(), BNB_AMOUNT_IN);
  lost.rpc.timestamp = BigInt(Math.floor(Date.parse(unlanded.quote.expiresAt) / 1000)) + 1n; lost.advance(901_000);
  const expired = await lost.runtime.status(unlanded.operationId, lost.clock.now());
  assert.equal(expired.state, "expired_unlanded"); assert.equal(await lost.usage(), "0"); assert.equal(lost.rpc.sends.length, 1);
});

test("preparation refuses a policy that admits another BNB route, and the BNB observer refuses another chain's swap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const route = swapRouteOf(BNB_UNISWAP_MECHANISM_PIN);
  const narrower = { ...route, auxiliaryContractProgramIdentities: route.auxiliaryContractProgramIdentities.filter((pool) => pool !== BNB_UNISWAP_USDT_WBNB_500) };
  const f = await flow(temporary.root, { mechanism: narrower });
  await assert.rejects(f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "bnb-flow-0006" }, f.clock.now()),
    (error: any) => error.details?.reason === "swap_owner_admission_required" && error.details?.admissionGap === "swap_route_not_admitted" &&
      error.details?.nextActions?.includes("apn swap bnb uniswap inventory"));
  const other = await temporaryState(); t.after(other.cleanup);
  const g = await flow(other.root);
  const prepared = await g.runtime.prepare({ profile: PROFILE, quoteHash: g.quoted.quoteHash, idempotencyKey: "bnb-flow-0007" }, g.clock.now());
  const sent = await g.runtime.approveAndExecute(prepared.operationId, g.clock.now());
  // Each lane's observer reads only its own chain's swaps, before any RPC read.
  const calls = g.rpc.calls.length;
  await assert.rejects(new UniswapEthereumReceiptObserver(g.rpc.call).receiptEconomics(sent), (error: any) => error.details?.reason === "uniswap_observer_chain");
  await assert.rejects(new UniswapEthereumReceiptObserver(g.rpc.call).proveUnlanded(1, async () => null), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(g.rpc.calls.length, calls + 1, "only the unlanded proof's chain id read");
  assert.equal(await new UniswapBnbReceiptObserver(g.rpc.call, g.clock.now).observeOutcome(sent, (await bindingOf(g.state.root, sent))!, txHash(g.rpc)), null);
});
