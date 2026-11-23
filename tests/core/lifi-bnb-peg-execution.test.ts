/**
 * The Binance-Peg pairs through the bridge service, end to end on the test chains: owner policy in the source asset's
 * own decimals, prepare, consent, the approval and bridge sends, the source and destination proofs, the usage ledger,
 * the receipt and the consent text. BNB Smart Chain is the source in one direction and the destination in the other.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import { approvalCode } from "../../src/approval-code.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { acrossBridgeAbi } from "../../src/lifi/abi.js";
import { BridgeAllowlistGate } from "../../src/lifi/allowlist.js";
import type { BridgeRouteRequest } from "../../src/lifi/model.js";
import { bridgeReceipt, publicBridgeOperation } from "../../src/lifi/receipt.js";
import { TtyBridgeApproval } from "../../src/lifi/tty.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { lifiCapture } from "./lifi-capture.js";
import { addressWord } from "./lifi-event-fixtures.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_SENDER, LifiTestProvider, lifiFixture, type LifiJson } from "./lifi-helpers.js";
import { findStored } from "./stored-operations.js";

const capture = lifiCapture("lifi-bnb-peg-across-20261123.json") as LifiJson;
const NOW = new Date("2026-11-23T12:35:00.000Z");
const BSC_USDC = getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
const ETHEREUM_USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

/** The captured Across step, re-addressed to the test wallet and recipient and re-timed to the test clock. */
function pegStep(pair: "bsc-usdc-eth" | "eth-usdc-bsc"): LifiJson {
  const step = structuredClone(capture.pairs[pair].acrossStep) as LifiJson;
  const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data }), args = structuredClone(decoded.args) as unknown as any[];
  step.action.fromAddress = LIFI_SYNTHETIC_SENDER; step.action.toAddress = LIFI_RECIPIENT;
  step.includedSteps[1].action.toAddress = LIFI_RECIPIENT; step.transactionRequest.from = LIFI_SYNTHETIC_SENDER;
  args[0].receiver = LIFI_RECIPIENT; args[2].receiverAddress = addressWord(LIFI_RECIPIENT); args[2].refundAddress = addressWord(LIFI_SYNTHETIC_SENDER);
  args[2].quoteTimestamp = Math.floor(NOW.getTime() / 1000) - 10; args[2].fillDeadline = Math.floor(NOW.getTime() / 1000) + 3600;
  step.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
  return step;
}
async function pegRun(root: string, pair: "bsc-usdc-eth" | "eth-usdc-bsc", key: string) {
  const step = pegStep(pair), a = step.action, from = a.fromToken.decimals as number, to = a.toToken.decimals as number;
  const provider = new LifiTestProvider([step], NOW);
  const s = await lifiFixture(root, "eth-base", { now: NOW, provider });
  s.provider.statusValue = "completed_observed";
  s.source.balance = 100n * 10n ** BigInt(from);
  const request: BridgeRouteRequest = { fromChainId: a.fromChainId, toChainId: a.toChainId, fromToken: getAddress(a.fromToken.address),
    toToken: getAddress(a.toToken.address), amountAtomic: a.fromAmount, recipient: LIFI_RECIPIENT,
    minOutputAtomic: (19n * 10n ** BigInt(to)).toString(), maxNativeDebitWei: "20000000000000000",
    maxRouteFeeAtomic: (10n ** BigInt(from - 1)).toString(), slippageBps: 50 };
  const quotes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request });
  assert.equal(quotes.ok, true, quotes.error?.message);
  const prepared = await s.core.execute({ command: "bridge.prepare", profile: s.profile, quote: (quotes.data as any).quote_hash,
    route: "route-across", idempotencyKey: key });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operation_id: string }).operation_id, operation = (await findStored(s.core.bridges.records, id))!;
  s.source.op = operation; s.destination.op = operation;
  return { s, id, operation, request };
}
async function renderApproval(summary: ReturnType<typeof publicBridgeOperation>, operationId: string, fingerprint: string): Promise<string> {
  let printed = "";
  const phrase = approvalCode("bridge", fingerprint);
  const tty = new TtyBridgeApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 143,
    write: async (text) => { printed += text; }, read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => {} }) });
  assert.equal(await tty.confirm({ operationId, fingerprint, exactPhrase: phrase,
    summary: { ...summary, expires_at: new Date(Date.now() + 60_000).toISOString() } as typeof summary, compositeReturn: null }), true);
  return printed;
}

test("BSC Binance-Peg USDC to Ethereum USDC completes: 18-decimal debit, 6-decimal delivery, usage in the source's own units", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, operation, request } = await pegRun(temporary.root, "bsc-usdc-eth", "bnb-peg-bsc-eth-0001");
  assert.deepEqual([operation.intent.materialization.request.fromChainId, operation.intent.materialization.request.toChainId,
    operation.effects.map((effect) => effect.role)], [56, 1, ["approval", "bridge"]]);
  assert.equal(operation.intent.allowlist?.chain, "eip155:56");
  assert.deepEqual(operation.intent.allowlist?.asset, { kind: "token", identifier: BSC_USDC });
  assert.equal(operation.intent.implicitProtocolFeeAtomic, "820973750014");
  const summary = publicBridgeOperation(operation);
  assert.equal(summary.fees.token_loss_bound_atomic, null);
  assert.equal(summary.asset_bounds!.same_denomination, false);
  assert.deepEqual([summary.asset_bounds!.source.decimals, summary.asset_bounds!.destination.decimals], [18, 6]);
  assert.deepEqual(summary.asset_bounds!.scaled_precision, { finer_decimals: 18,
    token_loss_bound_source_atomic: "87173000000000000", rounding: "loss_rounded_up_to_source_atomic" });
  const printed = await renderApproval(summary, id, operation.fingerprint);
  for (const line of ["Source debit bound (eip155:56 USDC): principal 20000000000000000000 atomic",
    "Minimum destination output (eip155:1 USDC): 19912827 atomic",
    "Precision: source USDC 18 decimals, destination USDC 6 decimals; the same token value, not a conversion",
    "Token loss bound at this route: 87173000000000000 USDC atomic at 18 decimals (rounded up)",
    "Unitemized protocol fee: 820973750014 USDC atomic"]) assert.ok(printed.includes(line), line);
  assert.match(printed, /BNB Smart Chain \(eip155:56\) native fee is checked before sending/u);

  const completed = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(completed.ok, true, completed.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!;
  assert.equal(record.state, "completed");
  assert.doesNotThrow(() => validateBridgeOperation(record));
  assert.deepEqual([record.destinationProof?.chainId, record.destinationProof?.token, record.destinationProof?.amountAtomic],
    [1, ETHEREUM_USDC, "19912833"]);
  assert.ok(BigInt(record.destinationProof!.amountAtomic) >= BigInt(request.minOutputAtomic));
  assert.equal(s.source.submissions.length, 2);
  const receipt = bridgeReceipt(record);
  assert.equal(receipt.transfer.actual_output_atomic, "19912833");
  assert.equal(receipt.transfer.actual_source_atomic, request.amountAtomic);
  const binding = record.intent.allowlist!;
  const lease = await new AssetUsageLedger(temporary.root).load({ account: binding.account, chain: binding.chain, asset: binding.asset },
    record.usageLease!.reservationId);
  assert.deepEqual([lease?.state, lease?.amountAtomic], ["finalized", "20000000000000000000"]);
});

test("Ethereum USDC to BSC Binance-Peg USDC completes: 6-decimal debit, 18-decimal delivery", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, operation } = await pegRun(temporary.root, "eth-usdc-bsc", "bnb-peg-eth-bsc-0001");
  assert.deepEqual([operation.intent.materialization.request.fromChainId, operation.intent.materialization.request.toChainId], [1, 56]);
  assert.equal(operation.intent.destinationDeployment.chainId, 56);
  const summary = publicBridgeOperation(operation);
  assert.deepEqual(summary.asset_bounds!.scaled_precision, { finer_decimals: 18,
    token_loss_bound_source_atomic: "55416", rounding: "loss_rounded_up_to_source_atomic" });
  const completed = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(completed.ok, true, completed.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!;
  assert.equal(record.state, "completed");
  assert.deepEqual([record.destinationProof?.chainId, record.destinationProof?.token, record.destinationProof?.amountAtomic],
    [56, BSC_USDC, "19944584000000000000"]);
  assert.equal(record.destinationProof?.nativeTransfer, null);
});

test("native BNB as a source stays refused at the owner gate; a Binance-Peg source needs its own policy row", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const step = pegStep("bsc-usdc-eth"), provider = new LifiTestProvider([step], NOW);
  const s = await lifiFixture(temporary.root, "eth-base", { now: NOW, provider, policy: false });
  s.source.balance = 100n * 10n ** 18n;
  const request: BridgeRouteRequest = { fromChainId: 56, toChainId: 1, fromToken: BSC_USDC, toToken: ETHEREUM_USDC, amountAtomic: step.action.fromAmount,
    recipient: LIFI_RECIPIENT, minOutputAtomic: "19000000", maxNativeDebitWei: "20000000000000000", maxRouteFeeAtomic: "100000000000000000", slippageBps: 50 };
  const quotes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request });
  assert.equal(quotes.ok, true, quotes.error?.message);
  const refused = await s.core.execute({ command: "bridge.prepare", profile: s.profile, quote: (quotes.data as any).quote_hash,
    route: "route-across", idempotencyKey: "bnb-peg-no-policy-0001" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error?.details?.reason, "allowlist_policy_required");
  assert.equal(s.provider.materializeCalls, 0); assert.equal(s.source.submissions.length, 0);
  // Native BNB never gets the token rows' source path, whatever a policy says.
  const gate = new BridgeAllowlistGate({ state: s.state, clock: { now: () => new Date(NOW) } });
  await assert.rejects(gate.admit(s.profile, LIFI_SYNTHETIC_SENDER, { ...request, fromToken: BRIDGE_ZERO_ADDRESS, toToken: BRIDGE_ZERO_ADDRESS,
    amountAtomic: "100000000000000", minOutputAtomic: "90000000000000", maxRouteFeeAtomic: "10000000000000" }, "across"),
  (error: any) => error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "bridge_source_execution_unreviewed");
});
