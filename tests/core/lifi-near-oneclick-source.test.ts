import assert from "node:assert/strict";
import test from "node:test";
import { inspectOneClickSourceQuote } from "../../src/lifi/near-oneclick-source-service.js";
import { bindOneClickCommand } from "../../src/lifi/near-oneclick-command-catalog.js";
const now = Date.parse("2026-09-17T00:00:00.000Z");
const request = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100,
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  depositType: "ORIGIN_CHAIN", destinationAsset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
  amount: "3000000", refundTo: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7", refundType: "ORIGIN_CHAIN",
  recipient: "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF", recipientType: "DESTINATION_CHAIN",
  deadline: "2026-09-17T00:03:00.000Z" };
const response = { quoteRequest: request, quote: { amountIn: "3000000", minAmountIn: "2764874",
  amountOut: "1264167", minAmountOut: "1251525", deadline: "2026-09-20T00:00:00.000Z",
  depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8", depositMemo: null } };
test("1Click direct quote binds exact Base amount, recipient, minimum and short requested deadline", () => {
  const result = inspectOneClickSourceQuote(response, request, 1000000n, 2000000n, now);
  assert.equal(result.amountIn, 3000000n); assert.equal(result.minimum, 1251525n);
  assert.equal(result.deposit, "0x76b4c56085ED136a8744D52bE956396624a730E8");
  assert.equal(result.effectiveDeadline, request.deadline);
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quoteRequest: { ...request, recipient: "TWrong" } }, request, 1000000n, 2000000n, now));
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quote: { ...response.quote, minAmountOut: "999999" } }, request, 1000000n, 2000000n, now));
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quote: { ...response.quote, depositMemo: "123" } }, request, 1000000n, 2000000n, now));
  assert.throws(() => inspectOneClickSourceQuote(response, request, 1000000n, 2000000n, now + 150000));
  const earlier = { ...response, quote: { ...response.quote, deadline: "2026-09-17T00:01:10.000Z" } };
  assert.equal(inspectOneClickSourceQuote(earlier, request, 1000000n, 2000000n, now).effectiveDeadline,
    "2026-09-17T00:01:10.000Z");
  assert.throws(() => inspectOneClickSourceQuote({ ...response, quote: { ...response.quote,
    deadline: "2026-09-17T00:00:40.000Z" } }, request, 1000000n, 2000000n, now));
});
test("1Click command binding carries explicit limits", () => {
  const bound = bindOneClickCommand("oneclick source submit", { "--profile": "evm-live-buyer",
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
    let record = await repo.stage({ operationId: "a".repeat(64), profileHash: "b".repeat(64), payer: account.address,
      recipient: request.recipient, refundTo: account.address, depositAddress: deposit, quoteHash: "c".repeat(64),
      quoteRequestDeadline: request.deadline, quoteDeadline: response.quote.deadline,
      effectiveDeadline: request.deadline, amountInAtomic: "3000000", minAmountOutAtomic: "1251525",
      quotedAmountOutAtomic: "1264167", sourceBlockHash: `0x${"d".repeat(64)}`,
      sourceCall: { to: token, data, nonce: "7", gas: "100000", maxFeePerGas: "2000000000",
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
