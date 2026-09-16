import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { getBase58Encoder } from "@solana/kit";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { submitCircleV2BaseSourceBurn } from "../../src/lifi/circle-v2-source-execution.js";
import { NonEvmSourceJournalRepository } from "../../src/lifi/non-evm-source-journal.js";
import { temporaryState } from "./helpers.js";

const key = `0x${"1".repeat(64)}` as const;
const account = privateKeyToAccount(key);
const payer = account.address;
const wallet = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wrapper = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const hook = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const blockHash = `0x${"a".repeat(64)}`;
const abi = parseAbi(["function depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes signedQuote,address refundAddress)) payable"]);
const limits = { maxAllowanceAtomic: "1020000", maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
  maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
async function fixture() {
  const ata = await associatedUsdc(wallet);
  const recipient = `0x${Buffer.from(getBase58Encoder().encode(ata)).toString("hex")}` as `0x${string}`;
  const data = encodeFunctionData({ abi, functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 5, recipient, usdc,
    `0x${"0".repeat(64)}`, hook, { signedQuote: "0x01020304", refundAddress: payer }] });
  return { ata, input: { payer, quoteEndpoint: "https://iris-api.circle.com/v2/quote/burn/usdc/6/5" as const,
    quoteRequest: { amount: "1000000", feeToken: usdc, requests: [{ type: "FORWARD", params: { hookData: hook } }] },
    quoteResponse: { signedQuote: "0x01020304", issuedAt: Math.floor(Date.now() / 1000),
      expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 110 }, feeTotalAmount: "20000", feeToken: usdc, nonce: "0",
      items: [{ type: "FORWARD", amount: "18000", args: [wrapper, "5", usdc, `0x${"0".repeat(64)}`, hook], argsHash: `0x${"1".repeat(64)}` },
        { type: "PROTOCOL", amount: "2000", args: [], argsHash: `0x${"2".repeat(64)}` }] },
    transaction: { from: payer, to: wrapper, chainId: 8453 as const, valueAtomic: "0", refundAddress: payer, data },
    recipientWallet: wallet, amountAtomic: "1000000", maxSourceFeeAtomic: "25000", recipientSetup: "existing_ata" as const } };
}
function transport() {
  return async (request: any): Promise<unknown> => request.target === "circle"
    ? { signedQuote: "0x01020304", feeTotalAmount: "20000", feeToken: usdc, nonce: "0", claimable: true, failedChecks: [],
      expiry: { mode: "BLOCK_NUMBER", expired: false, secondsRemaining: 60, expiresAtBlock: 110 },
      items: [{ type: "FORWARD", argsMatch: true }, { type: "PROTOCOL", argsMatch: true }] }
    : request.method === "eth_getBlockByNumber"
      ? { number: "0x63", hash: blockHash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` }
      : "0x";
}
async function run(send: (raw: `0x${string}`) => Promise<`0x${string}`>, signerAddress = payer, driftAfterApproval = false, withLiveAdmission = true, admissionDrift = false) {
  const f = await fixture(), tmp = await temporaryState();
  const journal = new NonEvmSourceJournalRepository(tmp.root);
  let sends = 0, approved = false;
  const action = () => submitCircleV2BaseSourceBurn({ payer, solanaWalletOwner: wallet, solanaRecipientAta: f.ata,
    recipientSetup: "existing_ata", profileHash: "d".repeat(64), operationId: "e".repeat(64), limits,
    claimedValidationHash: "f".repeat(64), minFinalityThreshold: 1000 }, {
    freshDraft: async () => f.input, preflight: transport(),
    readBase: async query => ({ chainId: 8453, payer, draftBlockHash: blockHash, blockNumber: query.freshBlockNumber,
      blockHash: query.freshBlockHash, latestNonceAtomic: "7", pendingNonceAtomic: "7", usdcBalanceAtomic: "1020000",
      usdcAllowanceAtomic: approved && driftAfterApproval ? "0" : "1020000", nativeBalanceWei: "200000000000000", gasLimitAtomic: "100000",
      maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000",
      l1DataFeeUpperWei: "0", operatorFeeUpperWei: "0" }),
    signer: { kind: "imported_evm_signer", address: signerAddress, signTransaction: tx => account.signTransaction(tx) },
    sendRawTransaction: async raw => { sends++; return send(raw); }, approve: async () => { approved = true; }, journal,
    ...(withLiveAdmission ? { admitLive: async (p: any) => ({ kind: "circle_v2_live_transport_v1" as const,
      circleOrigin: "https://iris-api.circle.com" as const, rpcOrigin: "https://base.example.org",
      quoteHash: admissionDrift ? "2".repeat(64) : p.quoteHash.slice(7), validationHash: "1".repeat(64), sourceBlockHash: p.sourceBlock.hash,
      preparationDigest: p.preparationDigest.slice(7), payer, recipientOwner: wallet, recipientAta: f.ata,
      feeTotalAtomic: p.quote.feeTotalAtomic }) } : {}) });
  return { action, sends: () => sends, cleanup: tmp.cleanup, journal };
}
test("persists one signed source attempt, with delivery still unobserved", async t => {
  const h = await run(async raw => (await import("viem")).keccak256(raw)); t.after(h.cleanup);
  const result = await h.action();
  assert.equal(result.sourceState, "submitted_pending"); assert.equal(result.journal.submissionAttempts, 1);
  assert.equal(result.journal.signedTransaction !== null, true); assert.equal(result.bridgeCompletion, false);
  assert.equal(result.circleAttestationObserved, false); assert.equal(result.solanaDestinationFinalized, false);
  await assert.rejects(h.action()); assert.equal(h.sends(), 1);
});
test("ambiguous send is durable unknown and cannot resend", async t => {
  const h = await run(async () => { throw Error("timeout"); }); t.after(h.cleanup);
  const result = await h.action(); assert.equal(result.sourceState, "unknown_finality");
  assert.equal(result.journal.submissionAttempts, 1);
  await assert.rejects(h.action()); assert.equal(h.sends(), 1);
});
test("synthetic admission has no live source effect path", async t => {
  const h = await run(async raw => raw, payer, false, false); t.after(h.cleanup);
  await assert.rejects(h.action(), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.sends(), 0);
  assert.equal(await h.journal.load("d".repeat(64), "e".repeat(64)), null);
});
test("live admission bound to another quote cannot sign or send", async t => {
  const h = await run(async raw => raw, payer, false, true, true); t.after(h.cleanup);
  await assert.rejects(h.action(), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.sends(), 0);
  assert.equal(await h.journal.load("d".repeat(64), "e".repeat(64)), null);
});
test("wrong imported signer blocks before quote, journal and send", async t => {
  const h = await run(async raw => raw, getAddress("0x000000000000000000000000000000000000dEaD")); t.after(h.cleanup);
  await assert.rejects(h.action(), { code: "APN_OPERATION_BLOCKED" }); assert.equal(h.sends(), 0);
});

test("allowance lost during foreground consent blocks before durable send", async t => {
  const h = await run(async raw => raw, payer, true); t.after(h.cleanup);
  await assert.rejects(h.action()); assert.equal(h.sends(), 0);
  assert.equal(await h.journal.load("d".repeat(64), "e".repeat(64)), null);
});
