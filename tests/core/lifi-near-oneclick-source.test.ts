import assert from "node:assert/strict";
import test from "node:test";
import { inspectOneClickSourceQuote, oneClickStatusQuoteMatchesRecord, assertOneClickPostApproval } from "../../src/lifi/near-oneclick-source-service.js";
import type { OneClickSourceRecord } from "../../src/lifi/near-oneclick-source-journal.js";
import { bindOneClickCommand } from "../../src/lifi/near-oneclick-command-catalog.js";
import { oneClickLane } from "../../src/lifi/near-oneclick-lanes.js";
const lane = oneClickLane("base-usdc-to-tron-usdt");
const now = Date.parse("2026-09-17T00:00:00.000Z");
const request = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100,
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
  amount: "3000000", refundTo: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7", refundType: "ORIGIN_CHAIN",
  recipient: "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF", recipientType: "DESTINATION_CHAIN",
  deadline: "2026-09-17T00:03:00.000Z" };
const response = { timestamp: "2026-09-17T00:00:00.000Z", signature: "a".repeat(96), quoteRequest: request, quote: { amountIn: "3000000", minAmountIn: "2764874",
  amountOut: "1264167", minAmountOut: "1251525", deadline: "2026-09-20T00:00:00.000Z",
  depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8", depositMemo: null } };
test("1Click direct quote binds exact Base amount, recipient, minimum and short requested deadline", () => {
  const result = inspectOneClickSourceQuote(response, request, 1000000n, 2000000n, now, lane);
  assert.equal(result.amountIn, 3000000n); assert.equal(result.minimum, 1251525n);
  assert.equal(result.deposit, "0x76b4c56085ED136a8744D52bE956396624a730E8");
  assert.equal(result.effectiveDeadline, request.deadline);
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quoteRequest: { ...request, recipient: "TWrong" } }, request, 1000000n, 2000000n, now, lane));
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quote: { ...response.quote, minAmountOut: "999999" } }, request, 1000000n, 2000000n, now, lane));
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quote: { ...response.quote, depositMemo: "123" } }, request, 1000000n, 2000000n, now, lane));
  assert.throws(() => inspectOneClickSourceQuote(response, request, 1000000n, 2000000n, now + 150000, lane));
  const earlier = { ...response, quote: { ...response.quote, deadline: "2026-09-17T00:01:10.000Z" } };
  assert.equal(inspectOneClickSourceQuote(earlier, request, 1000000n, 2000000n, now, lane).effectiveDeadline,
    "2026-09-17T00:01:10.000Z");
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quote: { ...response.quote,
    deadline: "2026-09-17T00:00:40.000Z" } }, request, 1000000n, 2000000n, now, lane));
});
test("1Click command binding carries explicit limits", () => {
  const bound = bindOneClickCommand("oneclick source submit", { "--lane": "base-usdc-to-tron-usdt", "--profile": "evm-live-buyer",
    "--expected-payer": request.refundTo, "--recipient": request.recipient, "--amount-atomic": request.amount,
    "--min-output-atomic": "1000000", "--max-quoted-loss-atomic": "2000000", "--max-gas-limit-atomic": "100000",
    "--max-fee-per-gas-wei": "2000000000", "--max-priority-fee-per-gas-wei": "100000000",
    "--max-native-debit-wei": "200000000000000", "--idempotency-key": "tron-first" });
  assert.equal(bound.command, "oneclick.source.submit");
  if (bound.command === "oneclick.source.submit") assert.equal(bound.recipient, request.recipient);
});

test("durable 1Click journal seals exact ERC20 transfer and permits one submission", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { encodeFunctionData, keccak256, parseAbi } = await import("viem");
  const { OneClickSourceJournal } = await import("../../src/lifi/near-oneclick-source-journal.js");
  const { temporaryState } = await import("./helpers.js");
  const temp = await temporaryState();
  try {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const deposit = "0x76b4c56085ED136a8744D52bE956396624a730E8";
    const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const data = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
      functionName: "transfer", args: [deposit, 3000000n] });
    const repo = new OneClickSourceJournal(temp.root);
    let record = await repo.stage({ lane: "base-usdc-to-tron-usdt", operationId: "a".repeat(64), profileHash: "b".repeat(64), payer: account.address,
      recipient: request.recipient, refundTo: account.address, depositAddress: deposit, quoteHash: "c".repeat(64),
      quoteRequestDeadline: request.deadline, quoteDeadline: response.quote.deadline,
      effectiveDeadline: request.deadline, amountInAtomic: "3000000", minAmountOutAtomic: "1251525",
      quotedAmountOutAtomic: "1264167", sourceBlockHash: `0x${"d".repeat(64)}`,
      sourceCall: { to: token, data, value: "0", nonce: "7", gas: "100000", maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "100000000", maxNativeDebitWei: "200000000000000" } });
    record = await repo.advance(record.operationId, record.integrityHash, "signing_started");
    const raw = await account.signTransaction({ type: "eip1559", chainId: 8453, to: token, data, value: 0n,
      nonce: 7, gas: 100000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
    record = await repo.advance(record.operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
    assert.equal((await repo.load(record.operationId))?.rawTransaction, raw);
    record = await repo.advance(record.operationId, record.integrityHash, "submitting", { submissionAttempts: 1 });
    await assert.rejects(repo.advance(record.operationId, record.integrityHash, "submitting"));
    record = await repo.advance(record.operationId, record.integrityHash, "unknown_finality");
    await assert.rejects(repo.advance(record.operationId, record.integrityHash, "submitting"));
    assert.equal(record.submissionAttempts, 1);
  } finally { await temp.cleanup(); }
});

test("provider status binds the live quote shape despite a different outer correlation ID", () => {
  const liveRequest = { ...request, depositMode: "SIMPLE", appFees: [{ limitOrderId: null,
    recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 25 }],
    confidentiality: "public", insured: false, quoteWaitingTimeMs: 0 };
  const { insured: _insured, quoteWaitingTimeMs: _wait, ...statusBase } = liveRequest;
  const statusRequest = { ...statusBase, referral: null, virtualChainRecipient: null, virtualChainRefundRecipient: null };
  const liveQuote = { ...response.quote, amountInFormatted: "2.75", amountInUsd: "2.75", amountOutFormatted: "1.014691",
    amountOutUsd: "1.014691", timeWhenInactive: "2026-09-19T00:00:00.000Z", timeEstimate: 90,
    refundFee: "0", withdrawFee: "0" };
  const stable = { timestamp: "2026-09-17T00:00:00.000Z", signature: "a".repeat(96),
    quoteRequest: liveRequest, quote: liveQuote };
  const actualEnvelope = { correlationId: "quote-correlation", ...stable };
  const statusQuote = { ...stable, quoteRequest: statusRequest };
  const statusEnvelope = { correlationId: "status-correlation", quoteResponse: statusQuote, status: "PENDING_DEPOSIT" };
  const inspected = inspectOneClickSourceQuote(actualEnvelope, request, 1000000n, 2000000n, now, lane);
  const record = { schemaVersion: "apn.oneclick-source.v2" as const, quoteHash: inspected.quoteHash, payer: request.refundTo, refundTo: request.refundTo,
    recipient: request.recipient, depositAddress: response.quote.depositAddress,
    quoteRequestDeadline: request.deadline, quoteDeadline: response.quote.deadline,
    amountInAtomic: request.amount, quotedAmountOutAtomic: response.quote.amountOut,
    minAmountOutAtomic: response.quote.minAmountOut } as unknown as OneClickSourceRecord;
  assert.equal(oneClickStatusQuoteMatchesRecord(statusEnvelope.quoteResponse, record), true);
  const oldRecord = { ...record, schemaVersion: "apn.oneclick-source.v1" as const, quoteHash: "0".repeat(64) };
  assert.equal(oneClickStatusQuoteMatchesRecord(statusEnvelope.quoteResponse, oldRecord), true);
  for (const [kind, changed] of [
    ["signature", { signature: "b".repeat(96) }],
    ["appFees", { quoteRequest: { ...statusRequest, appFees: [{ recipient: "other", fee: 999999 }] } }],
    ["withdrawFee", { quote: { ...liveQuote, withdrawFee: "999999" } }],
    ["recipient", { quoteRequest: { ...statusRequest, recipient: "TWrong" } }],
    ["origin", { quoteRequest: { ...statusRequest, originAsset: "nep141:eth-other" } }],
    ["refund", { quoteRequest: { ...statusRequest, refundTo: "0x0000000000000000000000000000000000000001" } }],
    ["amount", { quote: { ...liveQuote, amountIn: "2749999" } }],
    ["deposit", { quote: { ...liveQuote, depositAddress: "0x0000000000000000000000000000000000000001" } }],
    ["minimum", { quote: { ...liveQuote, minAmountOut: "1" } }],
    ["deadline", { quoteRequest: { ...statusRequest, deadline: "2099-01-01T00:00:00.000Z" } }],
    ["insured", { quoteRequest: { ...statusRequest, insured: true } }],
    ["wait", { quoteRequest: { ...statusRequest, quoteWaitingTimeMs: 1 } }],
    ["referral", { quoteRequest: { ...statusRequest, referral: "other" } }],
    ["virtual recipient", { quoteRequest: { ...statusRequest, virtualChainRecipient: "other" } }],
  ] as const) assert.equal(oneClickStatusQuoteMatchesRecord({ ...statusQuote, ...changed }, record), false, kind);
  const { referral: _referral, ...missingNull } = statusRequest;
  assert.equal(oneClickStatusQuoteMatchesRecord({ ...statusQuote, quoteRequest: missingNull }, record), false);
  for (const [kind, changed] of [
    ["recipient", { quoteRequest: { ...liveRequest, recipient: "TWrong" } }],
    ["origin", { quoteRequest: { ...liveRequest, originAsset: "nep141:eth-other" } }],
    ["refund", { quoteRequest: { ...liveRequest, refundTo: "0x0000000000000000000000000000000000000001" } }],
    ["amount", { quote: { ...liveQuote, amountIn: "2749999" } }],
    ["deposit", { quote: { ...liveQuote, depositAddress: "0x0000000000000000000000000000000000000001" } }],
    ["minimum", { quote: { ...liveQuote, minAmountOut: "1" } }],
    ["deadline", { quoteRequest: { ...liveRequest, deadline: "2099-01-01T00:00:00.000Z" } }],
  ] as const) {
    assert.equal(oneClickStatusQuoteMatchesRecord({ ...stable, ...changed }, oldRecord), false, kind);
  }
});

test("post approval permits bounded L1 oracle movement but rejects nonce, gas, fee and cap drift", () => {
  const initial = { nonce: 141n, gas: 75572n, fee: 11000000n, tip: 1000000n };
  const fresh = { ...initial, nativeDebit: 851597280174n };
  const deadline = now + 120000;
  assert.doesNotThrow(() => assertOneClickPostApproval(initial, fresh, 20000000000000n, deadline, now));
  assert.throws(() => assertOneClickPostApproval(initial, { ...fresh, nonce: 142n }, 20000000000000n, deadline, now));
  assert.throws(() => assertOneClickPostApproval(initial, { ...fresh, gas: 75573n }, 20000000000000n, deadline, now));
  assert.throws(() => assertOneClickPostApproval(initial, { ...fresh, fee: 11000001n }, 20000000000000n, deadline, now));
  assert.throws(() => assertOneClickPostApproval(initial, fresh, 850018837265n, deadline, now));
  assert.throws(() => assertOneClickPostApproval(initial, fresh, 20000000000000n, deadline, deadline - 20000));
});
