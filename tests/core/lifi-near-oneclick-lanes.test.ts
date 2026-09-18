import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { parseCatalogArgv } from "../../src/command-catalog.js";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { bindOneClickCommand, oneClickSubmitHandoff } from "../../src/lifi/near-oneclick-command-catalog.js";
import { assertOneClickNativePostApproval, planOneClickNative, type OneClickNativeObservation } from "../../src/lifi/near-oneclick-evm-source.js";
import { ONECLICK_LANE_IDS, ONECLICK_LANES, oneClickLane, oneClickRecipient } from "../../src/lifi/near-oneclick-lanes.js";
import { OneClickSourceJournal, oneClickRecordLane, oneClickSourceCall } from "../../src/lifi/near-oneclick-source-journal.js";
import { inspectOneClickSourceQuote, oneClickOperationId, oneClickStatusQuoteMatchesRecord } from "../../src/lifi/near-oneclick-source-service.js";
import { temporaryState } from "./helpers.js";

const payer = privateKeyToAccount(`0x${"1".repeat(64)}`).address;
const deposit = "0x76b4c56085ED136a8744D52bE956396624a730E8";
const TRON = "TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS", SOL = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
const now = Date.parse("2026-09-18T05:00:00.000Z");
const submit = (lane: string, recipient: string) => ({ "--lane": lane, "--profile": "evm-live-buyer", "--expected-payer": payer,
  "--recipient": recipient, "--amount-atomic": "2000000000000000", "--min-output-atomic": "13000000", "--max-quoted-loss-atomic": "200000",
  "--max-gas-limit-atomic": "60000", "--max-fee-per-gas-wei": "20000000000", "--max-priority-fee-per-gas-wei": "2000000000",
  "--max-native-debit-wei": "2600000000000000", "--idempotency-key": "trx-fund-1" });

test("the lane registry is an exact pinned list with 1Click asset IDs and decimals", () => {
  assert.deepEqual(ONECLICK_LANES.map(lane => [lane.id, lane.origin.oneClickAsset, lane.origin.decimals, lane.destination.oneClickAsset, lane.destination.decimals]), [
    ["base-usdc-to-tron-usdt", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", 6, "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", 6],
    ["ethereum-eth-to-tron-trx", "nep141:eth.omft.near", 18, "nep141:tron.omft.near", 6],
    ["ethereum-eth-to-solana-sol", "nep141:eth.omft.near", 18, "nep141:sol.omft.near", 9],
    ["ethereum-eth-to-tron-usdt", "nep141:eth.omft.near", 18, "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", 6],
  ]);
  assert.deepEqual([...ONECLICK_LANE_IDS], ONECLICK_LANES.map(lane => lane.id));
  for (const unlisted of ["", "*", "base-usdc-to-solana-sol", "ethereum-eth-to-base-usdc", "ETHEREUM-ETH-TO-TRON-TRX", "ethereum-usdc-to-tron-trx"]) {
    assert.throws(() => oneClickLane(unlisted), { code: "APN_INVALID_INPUT" }, unlisted);
    assert.throws(() => bindOneClickCommand("oneclick source submit", submit(unlisted, TRON)), { code: "APN_INVALID_INPUT" }, unlisted);
  }
  assert.throws(() => parseCatalogArgv(["oneclick", "source", "submit", ...Object.entries(submit("ethereum-eth-to-tron-trx", TRON))
    .filter(([key]) => key !== "--lane").flat()]), /Missing required --lane/u);
});

test("recipients must be canonical for the destination chain", () => {
  const trx = oneClickLane("ethereum-eth-to-tron-trx"), sol = oneClickLane("ethereum-eth-to-solana-sol");
  assert.equal(oneClickRecipient(trx, TRON), TRON);
  assert.equal(oneClickRecipient(sol, SOL), SOL);
  assert.throws(() => oneClickRecipient(trx, SOL), { code: "APN_INVALID_INPUT" });
  assert.throws(() => oneClickRecipient(sol, TRON), { code: "APN_INVALID_INPUT" });
  assert.throws(() => oneClickRecipient(trx, "4120b7f7a2e0b40b7a7a3c2cdb2c8e5e8a3f3d3c2a"), { code: "APN_INVALID_INPUT" });
  assert.throws(() => oneClickRecipient(trx, `${TRON.slice(0, -1)}T`), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bindOneClickCommand("oneclick source submit", submit("ethereum-eth-to-solana-sol", TRON)), { code: "APN_INVALID_INPUT" });
  const bound = bindArgv(["oneclick", "source", "submit", ...Object.entries(submit("ethereum-eth-to-solana-sol", SOL)).flat()]).request;
  assert.equal(bound.command, "oneclick.source.submit");
  if (bound.command === "oneclick.source.submit") { assert.equal(bound.lane, "ethereum-eth-to-solana-sol"); assert.equal(bound.recipient, SOL); }
});

test("MCP projects the same catalog and hands money approval to the exact foreground command", () => {
  const tool = projectMcpTools().find(entry => entry.name === "apn_oneclick_source_submit")!;
  const input = Object.fromEntries(Object.entries(submit("ethereum-eth-to-tron-trx", TRON)).map(([key, value]) => [key.slice(2).replaceAll("-", "_"), value]));
  const bound = bindMcpInput(tool.command, input).request;
  assert.equal(bound.command, "oneclick.source.submit");
  if (bound.command !== "oneclick.source.submit") return;
  const handoff = oneClickSubmitHandoff(bound);
  assert.deepEqual(handoff.argv, ["apn", "oneclick", "source", "submit", ...Object.entries(submit("ethereum-eth-to-tron-trx", TRON)).flat()]);
  assert.deepEqual(bindArgv(handoff.argv.slice(1)).request, bound);
  assert.equal(tool.command.approval.class, "foreground_tty");
});

test("the MCP submit tool returns the foreground handoff before any quote, RPC or state access", async (t) => {
  t.mock.method(BridgeHttps.prototype, "request", async () => assert.fail("MCP must not reach 1Click or an RPC"));
  const server = createMcpServer(), client = new Client({ name: "oneclick-lanes", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const args = Object.fromEntries(Object.entries(submit("ethereum-eth-to-solana-sol", SOL)).map(([key, value]) => [key.slice(2).replaceAll("-", "_"), value]));
  const result = await client.callTool({ name: "apn_oneclick_source_submit", arguments: args });
  const envelope = result.structuredContent as unknown as OutputEnvelope;
  assert.equal(envelope.ok, false); assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(envelope.error?.details?.cli_handoff_argv, ["apn", "oneclick", "source", "submit", ...Object.entries(submit("ethereum-eth-to-solana-sol", SOL)).flat()]);
  const unlisted = await client.callTool({ name: "apn_oneclick_source_submit", arguments: { ...args, lane: "ethereum-eth-to-base-usdc" } });
  assert.equal((unlisted.structuredContent as unknown as OutputEnvelope).error?.code, "APN_INVALID_INPUT");
});

const request = (lane: string, recipient: string) => ({ dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100,
  originAsset: oneClickLane(lane).origin.oneClickAsset, depositType: "ORIGIN_CHAIN", destinationAsset: oneClickLane(lane).destination.oneClickAsset,
  amount: "2000000000000000", refundTo: payer, refundType: "ORIGIN_CHAIN", recipient, recipientType: "DESTINATION_CHAIN",
  deadline: "2026-09-18T05:03:00.000Z" });
const quote = (req: Record<string, unknown>, changes: Record<string, unknown> = {}) => ({ timestamp: "2026-09-18T05:00:00.000Z",
  signature: `ed25519:${"a".repeat(80)}`, quoteRequest: req, quote: { amountIn: "2000000000000000", minAmountIn: "2000000000000000",
    amountOut: "13335728", minAmountOut: "13202370", deadline: "2026-09-19T05:00:00.000Z", depositAddress: deposit, ...changes } });

test("native quotes bind the lane assets and bound the quoted loss in destination units", () => {
  const lane = oneClickLane("ethereum-eth-to-tron-trx"), req = request(lane.id, TRON);
  const inspected = inspectOneClickSourceQuote(quote(req), req, 13_000_000n, 133_358n, now, lane);
  assert.equal(inspected.minimum, 13_202_370n); assert.equal(inspected.deposit, deposit);
  // 13,335,728 quoted minus 13,202,370 minimum is 133,358 SUN.
  assert.throws(() => inspectOneClickSourceQuote(quote(req), req, 13_000_000n, 133_357n, now, lane), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => inspectOneClickSourceQuote(quote(req), req, 13_202_371n, 200_000n, now, lane), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => inspectOneClickSourceQuote(quote(req), req, 13_000_000n, 200_000n, now, oneClickLane("ethereum-eth-to-solana-sol")), /quote_lane/u);
  const other = { ...req, destinationAsset: oneClickLane("ethereum-eth-to-solana-sol").destination.oneClickAsset };
  assert.throws(() => inspectOneClickSourceQuote(quote(other), other, 1n, 200_000n, now, lane), /quote_lane/u);
  assert.throws(() => inspectOneClickSourceQuote(quote(req, { depositAddress: payer }), req, 13_000_000n, 200_000n, now, lane), /deposit_address/u);
  assert.throws(() => inspectOneClickSourceQuote(quote(req, { depositAddress: `0x${"0".repeat(40)}` }), req, 13_000_000n, 200_000n, now, lane), /deposit_address/u);
  assert.throws(() => inspectOneClickSourceQuote(quote(req, { amountIn: "1999999999999999" }), req, 13_000_000n, 200_000n, now, lane));
  // The stable lane keeps its input-at-par loss: 2,000,000 USDC atomic in, 1,000,000 minimum out.
  const base = oneClickLane("base-usdc-to-tron-usdt"), baseReq = { ...request(base.id, TRON), amount: "2000000" };
  const baseQuote = { ...quote(baseReq), quote: { amountIn: "2000000", minAmountIn: "2000000", amountOut: "1010000",
    minAmountOut: "1000000", deadline: "2026-09-19T05:00:00.000Z", depositAddress: deposit } };
  assert.doesNotThrow(() => inspectOneClickSourceQuote(baseQuote, baseReq, 1_000_000n, 1_000_000n, now, base));
  assert.throws(() => inspectOneClickSourceQuote(baseQuote, baseReq, 1_000_000n, 999_999n, now, base), { code: "APN_OPERATION_BLOCKED" });
});

test("native source plan caps value plus fee and tolerates only bounded base fee drift after consent", () => {
  const observed: OneClickNativeObservation = { blockHash: `0x${"a".repeat(64)}`, nonce: 4n, depositCode: "eoa", gas: 21_000n,
    baseFee: 1_000_000_000n, tip: 100_000_000n, balance: 21_200_000_000_000_000n };
  const amount = 2_000_000_000_000_000n, caps = { maxGas: 60_000n, maxFee: 20_000_000_000n, maxPriority: 100_000_000n, maxNative: 2_600_000_000_000_000n };
  const plan = planOneClickNative(observed, amount, caps);
  assert.equal(plan.fee, 2_100_000_000n); assert.equal(plan.nativeDebit, amount + 21_000n * 2_100_000_000n);
  // The signed tip is the owner's explicit priority fee, never the RPC suggestion (public Ethereum RPCs suggest 0).
  assert.equal(plan.tip, caps.maxPriority);
  assert.equal(planOneClickNative({ ...observed, tip: 0n }, amount, caps).tip, caps.maxPriority);
  assert.throws(() => planOneClickNative(observed, amount, { ...caps, maxNative: plan.nativeDebit - 1n }), /native_balance_or_cap/u);
  assert.throws(() => planOneClickNative({ ...observed, balance: plan.nativeDebit - 1n }, amount, caps), /native_balance_or_cap/u);
  assert.throws(() => planOneClickNative(observed, amount, { ...caps, maxFee: 2_099_999_999n }), /gas_fee/u);
  assert.throws(() => planOneClickNative(observed, amount, { ...caps, maxPriority: 0n }), /gas_fee/u);
  assert.throws(() => planOneClickNative({ ...observed, gas: 60_001n, depositCode: "contract" }, amount, caps), /gas_fee/u);
  const deadline = now + 120_000;
  assert.doesNotThrow(() => assertOneClickNativePostApproval(plan, { ...observed, baseFee: 2_000_000_000n, tip: 900_000_000n }, amount, deadline, now));
  for (const fresh of [{ ...observed, nonce: 5n }, { ...observed, depositCode: "contract" as const }, { ...observed, gas: 21_001n },
    { ...observed, baseFee: 2_000_000_001n }, { ...observed, balance: plan.nativeDebit - 1n }]) {
    assert.throws(() => assertOneClickNativePostApproval(plan, fresh, amount, deadline, now), /post_approval_drift/u);
  }
  assert.throws(() => assertOneClickNativePostApproval(plan, observed, amount, deadline, deadline - 20_000), /post_approval_drift/u);
});

class TestJournal extends OneClickSourceJournal {
  async put(id: string, value: unknown): Promise<void> { await this.initialize(); await this.ensureDirectory("oneclick-source"); await this.writeJson(`oneclick-source/${id}.json`, value); }
  async reservation(path: string): Promise<unknown> { return await this.readJson(path); }
}
const base = { profileHash: "b".repeat(64), payer, recipient: "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF", refundTo: payer, depositAddress: deposit,
  quoteHash: "c".repeat(64), quoteRequestDeadline: "2026-09-17T00:03:00.000Z", quoteDeadline: "2026-09-20T00:00:00.000Z",
  effectiveDeadline: "2026-09-17T00:03:00.000Z", amountInAtomic: "3000000", minAmountOutAtomic: "1251525", quotedAmountOutAtomic: "1264167",
  sourceBlockHash: `0x${"d".repeat(64)}` };
const usdcData = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [deposit, 3000000n] });

test("legacy v1 and v2 records stay readable as the Base USDC to TRON USDT lane", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const journal = new TestJournal(temp.root);
  for (const schemaVersion of ["apn.oneclick-source.v1", "apn.oneclick-source.v2"] as const) {
    const operationId = schemaVersion.endsWith("v1") ? "1".repeat(64) : "2".repeat(64);
    const body = { ...base, schemaVersion, operationId, sourceCall: { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: usdcData, nonce: "7",
      gas: "100000", maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000", maxNativeDebitWei: "200000000000000" },
      phase: "prepared", rawTransaction: null, transactionHash: null, submissionAttempts: 0, sourceReceiptStatus: null, sourceReceiptHash: null,
      destinationStatus: null, updatedAt: "2026-09-17T00:00:00.000Z" };
    await journal.put(operationId, { ...body, integrityHash: hashObject(body) });
    const loaded = await journal.load(operationId);
    assert.equal(loaded?.schemaVersion, schemaVersion);
    assert.equal(oneClickRecordLane(loaded!).id, "base-usdc-to-tron-usdt");
    const withLane = { ...body, lane: "base-usdc-to-tron-usdt" };
    await journal.put(operationId, { ...withLane, integrityHash: hashObject(withLane) });
    await assert.rejects(journal.load(operationId), { code: "APN_STATE_CORRUPT" });
  }
  // Lane (a) keeps the original operation derivation, so an old idempotency key still finds its operation.
  assert.equal(oneClickOperationId(oneClickLane("base-usdc-to-tron-usdt"), "b".repeat(64), "tron-first"),
    createHash("sha256").update(`oneclick-base-tron\0${"b".repeat(64)}\0tron-first`).digest("hex"));
  assert.notEqual(oneClickOperationId(oneClickLane("ethereum-eth-to-tron-trx"), "b".repeat(64), "tron-first"),
    oneClickOperationId(oneClickLane("ethereum-eth-to-solana-sol"), "b".repeat(64), "tron-first"));
  assert.equal(oneClickStatusQuoteMatchesRecord({}, { ...base, schemaVersion: "apn.oneclick-source.v3" } as never), false);
});

test("v3 native records seal only the exact Ethereum value transfer and reserve nonces per chain", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`), journal = new TestJournal(temp.root);
  const lane = oneClickLane("ethereum-eth-to-tron-trx"), amount = "2000000000000000";
  const call = oneClickSourceCall(lane, deposit, amount);
  assert.deepEqual(call, { to: deposit, data: "0x", value: amount });
  const stage = (operationId: string, extra: Record<string, unknown> = {}) => journal.stage({ ...base, lane: lane.id, operationId, recipient: TRON,
    amountInAtomic: amount, minAmountOutAtomic: "13202370", quotedAmountOutAtomic: "13335728", depositCode: "eoa",
    sourceCall: { ...call, nonce: "7", gas: "21000", maxFeePerGas: "2100000000", maxPriorityFeePerGas: "100000000", maxNativeDebitWei: "2600000000000000" }, ...extra });
  await assert.rejects(stage("3".repeat(64), { depositCode: undefined }), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(stage("3".repeat(64), { recipient: SOL }), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(stage("3".repeat(64), { sourceCall: { ...call, value: "1", nonce: "7", gas: "21000", maxFeePerGas: "1", maxPriorityFeePerGas: "1", maxNativeDebitWei: "1" } }), { code: "APN_STATE_CORRUPT" });
  let record = await stage("4".repeat(64));
  assert.equal(record.schemaVersion, "apn.oneclick-source.v3"); assert.equal(record.lane, lane.id);
  record = await journal.advance(record.operationId, record.integrityHash, "signing_started");
  const fees = { nonce: 7, gas: 21000n, maxFeePerGas: 2100000000n, maxPriorityFeePerGas: 100000000n, accessList: [] } as const;
  const wrongChain = await account.signTransaction({ type: "eip1559", chainId: 8453, to: deposit, value: BigInt(amount), ...fees });
  await assert.rejects(journal.advance(record.operationId, record.integrityHash, "sealed", { rawTransaction: wrongChain, transactionHash: keccak256(wrongChain) }));
  const wrongValue = await account.signTransaction({ type: "eip1559", chainId: 1, to: deposit, value: BigInt(amount) + 1n, ...fees });
  await assert.rejects(journal.advance(record.operationId, record.integrityHash, "sealed", { rawTransaction: wrongValue, transactionHash: keccak256(wrongValue) }));
  const raw = await account.signTransaction({ type: "eip1559", chainId: 1, to: deposit, value: BigInt(amount), ...fees });
  record = await journal.advance(record.operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
  assert.equal(record.rawTransaction, raw);
  assert.deepEqual(await journal.reservation(`oneclick-source-nonces/${"b".repeat(64)}/eip155-1/${payer.toLowerCase()}-7.json`),
    { operationId: record.operationId, transactionHash: keccak256(raw) });
  assert.equal(await journal.reservation(`oneclick-source-nonces/${"b".repeat(64)}/${payer.toLowerCase()}-7.json`), null);
});
