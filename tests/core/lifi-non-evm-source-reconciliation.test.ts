import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, parseAbi, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { BASE_CCTP_V2_MESSAGE_TRANSMITTER, BASE_CCTP_V2_TOKEN_MESSENGER, BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
  type CircleV2BurnIntent } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceBinding } from "../../src/lifi/non-evm-source-journal.js";
import { reconcileCircleV2BaseSource } from "../../src/lifi/non-evm-source-reconciliation.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";
import type { BridgeTransactionProof, BridgeProtocolReceipt } from "../../src/lifi/model.js";
import { BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const usdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const ata = `0x${"ab".repeat(32)}` as Hex;
const messenger = "0xa65fc81d0fefa8860cb3b83f089b0224be8a6687b7ae49f594c0b9b4d7e93893" as Hex;
const origin = "https://base.example";
const block = { numberAtomic: "123", hash: `0x${"34".repeat(32)}` as Hex, timestampAtomic: "1" };
const safe = { numberAtomic: "125", hash: `0x${"56".repeat(32)}` as Hex, timestampAtomic: "2" };
const callAbi = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const burnAbi = parseAbi(["event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)"]);
const sentAbi = parseAbi(["event MessageSent(bytes message)"]);
const word = (value: string) => `0x${"0".repeat(24)}${value.slice(2).toLowerCase()}` as Hex;
const n = (value: bigint, bytes: number) => value.toString(16).padStart(bytes * 2, "0");
const message = (`0x${n(1n,4)}${n(6n,4)}${n(5n,4)}${BRIDGE_ZERO_WORD.slice(2)}${word(BASE_CCTP_V2_TOKEN_MESSENGER).slice(2)}${messenger.slice(2)}${BRIDGE_ZERO_WORD.slice(2)}` +
  `${n(1000n,4)}${n(0n,4)}${n(1n,4)}${word(usdc).slice(2)}${ata.slice(2)}${n(100000000n,32)}${word(BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES).slice(2)}` +
  `${n(500000n,32)}${n(0n,32)}${n(0n,32)}`) as Hex;
const data = encodeFunctionData({ abi: callAbi, functionName: "depositForBurnWithHookAndFees", args: [100000000n, 5, ata, usdc, BRIDGE_ZERO_WORD, "0x",
  { signedQuote: "0x1234", refundAddress: account.address }] });
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const binding: NonEvmSourceBinding = { profileHash: "a".repeat(64), operationId: "b".repeat(64), draftIntegrityHash: "c".repeat(64),
  route: "base_usdc_to_solana_usdc_circle_cctp_v2", createdAt: "2026-09-16T00:00:00.000Z", maxSourceNativeDebitWei: "1000000000000000",
  sourceCall: { chainId: 8453, from: account.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, valueAtomic: "0", data: data as Hex,
    dataSha256: sha256(Buffer.from(data.slice(2), "hex")), type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
    maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
  admissionProof: { kind: "synthetic_untrusted", claimedValidationHash: "d".repeat(64), note: "offline test" } };
async function setup() {
  const tmp = await temporaryState(); const repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(binding);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, "2026-09-16T00:00:01.000Z");
  const raw = await account.signTransaction({ chainId: 8453, to: binding.sourceCall.to as Hex, data: data as Hex, value: 0n, nonce: 7, gas: 100000n,
    maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, "7", "2026-09-16T00:00:02.000Z");
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, "2026-09-16T00:00:03.000Z");
  const intent: CircleV2BurnIntent = { sourceTransactionHash: j.transactionHash as Hex, sourceFrom: account.address,
    amountAtomic: "100000000", solanaAtaBytes32: ata, maxFeeAtomic: "500000", minFinalityThreshold: 1000, hookData: "0x" };
  const receipt: Mutable<BridgeProtocolReceipt> = { chainId: 8453, transactionHash: j.transactionHash as Hex, blockHash: block.hash,
    blockNumberAtomic: block.numberAtomic, logs: [
      { address: BASE_CCTP_V2_MESSAGE_TRANSMITTER, topics: encodeEventTopics({ abi: sentAbi, eventName: "MessageSent" }) as Hex[],
        data: encodeAbiParameters([{ type: "bytes" }], [message]) },
      { address: BASE_CCTP_V2_TOKEN_MESSENGER, topics: encodeEventTopics({ abi: burnAbi, eventName: "DepositForBurn",
        args: { burnToken: usdc, depositor: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, minFinalityThreshold: 1000 } }) as Hex[],
        data: encodeAbiParameters(burnAbi[0].inputs.filter(i => !("indexed" in i)), [100000000n, ata, 5, messenger, BRIDGE_ZERO_WORD, 500000n, "0x"]) },
    ] };
  const tx = { chainId: 8453, transactionHash: j.transactionHash as Hex, block, safeBlock: safe, rpcOrigin: origin,
    from: account.address, to: binding.sourceCall.to, nonceAtomic: "7", valueAtomic: "0", dataHash: binding.sourceCall.dataSha256,
    gasLimitAtomic: "100000", maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", status: "success",
    logsHash: hashObject(receipt.logs) } as Mutable<BridgeTransactionProof>;
  const rpc = { chainId: 8453, origin, observe: async () => ({ transaction: tx, receipt }) } as Pick<BridgeRpcPort, "chainId" | "origin" | "observe">;
  return { tmp, repo, j, intent, tx, receipt, rpc };
}
const at = "2026-09-16T00:00:04.000Z";
test("supplied RPC source observation remains untrusted and leaves nonce reservation intact", async t => {
  const f = await setup(); t.after(f.tmp.cleanup);
  // This in-memory port has no block-membership verification. Its arbitrary safe hash
  // must never be promoted to a trusted source-confirmed state.
  f.tx.safeBlock = { ...safe, hash: `0x${"fa".repeat(32)}` };
  const j = await reconcileCircleV2BaseSource({ journal: f.j, repository: f.repo, rpc: f.rpc, intent: f.intent, expectedRpcOrigin: origin, observedAt: at });
  assert.equal(j.phase, "source_observed_untrusted"); assert.equal(j.safeSourceProof?.provenance, "rpc_observed_untrusted_circle_v2_base_source_v1");
  assert.equal(j.safeSourceProof?.status, "success"); assert.notEqual(j.phase, "source_confirmed");
  assert.equal(j.executionAdmitted, false); assert.equal(j.submissionAttempts, 1);
  assert.equal((j.safeSourceProof as { bridgeCompletion: boolean }).bridgeCompletion, false);
  assert.equal("destinationProof" in j, false);
  await assert.rejects(f.repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at), { code: "APN_OPERATION_BLOCKED" });
});
test("a fabricated revert is also untrusted and its proof clears on inconsistent reobservation", async t => {
  const f = await setup(); t.after(f.tmp.cleanup);
  f.tx.status = "reverted";
  const input = { journal: f.j, repository: f.repo, rpc: f.rpc, intent: f.intent, expectedRpcOrigin: origin, observedAt: at };
  const observed = await reconcileCircleV2BaseSource(input);
  assert.equal(observed.phase, "source_observed_untrusted");
  assert.equal(observed.safeSourceProof?.status, "reverted");
  assert.equal((observed.safeSourceProof as { protocolProofHash: string | null }).protocolProofHash, null);
  f.tx.status = "success";
  const changed = await reconcileCircleV2BaseSource({ ...input, journal: observed, observedAt: "2026-09-16T00:00:05.000Z" });
  assert.equal(changed.phase, "unknown_finality");
  assert.equal(changed.safeSourceProof, null);
});
test("missing safe block and each bound transaction or receipt field become unknown finality", async t => {
  const changes: Array<(f: Awaited<ReturnType<typeof setup>>) => void> = [
    f => { f.tx.safeBlock = null; }, f => { f.tx.transactionHash = `0x${"f".repeat(64)}`; },
    f => { f.tx.from = usdc; }, f => { f.tx.to = usdc; }, f => { f.tx.valueAtomic = "1"; },
    f => { f.tx.dataHash = "e".repeat(64); }, f => { f.tx.nonceAtomic = "8"; },
    f => { f.tx.gasLimitAtomic = "99999"; }, f => { f.tx.maxFeePerGasAtomic = "2"; },
    f => { f.tx.maxPriorityFeePerGasAtomic = "2"; }, f => { f.tx.logsHash = "e".repeat(64); },
    f => { f.tx.rpcOrigin = "https://other.example"; }, f => { f.receipt.blockHash = `0x${"f".repeat(64)}`; },
    f => { f.receipt.blockNumberAtomic = "124"; }, f => { f.receipt.transactionHash = `0x${"f".repeat(64)}`; },
  ];
  for (const change of changes) {
    const f = await setup(); t.after(f.tmp.cleanup); change(f);
    const j = await reconcileCircleV2BaseSource({ journal: f.j, repository: f.repo, rpc: f.rpc, intent: f.intent, expectedRpcOrigin: origin, observedAt: at });
    assert.equal(j.phase, "unknown_finality"); assert.equal(j.safeSourceProof, null); assert.equal(j.submissionAttempts, 1);
  }
});
test("protocol intent mismatch and reorg clear source proof", async t => {
  const f = await setup(); t.after(f.tmp.cleanup);
  const input = { journal: f.j, repository: f.repo, rpc: f.rpc, intent: f.intent, expectedRpcOrigin: origin, observedAt: at };
  const bad = await reconcileCircleV2BaseSource({ ...input, intent: { ...f.intent, solanaAtaBytes32: `0x${"cd".repeat(32)}` as Hex } });
  assert.equal(bad.phase, "unknown_finality");
  const good = await reconcileCircleV2BaseSource({ ...input, journal: bad, observedAt: "2026-09-16T00:00:05.000Z" });
  assert.equal(good.phase, "source_observed_untrusted");
  f.tx.block = { ...block, hash: `0x${"ee".repeat(32)}` };
  f.receipt.blockHash = f.tx.block.hash;
  const reorg = await reconcileCircleV2BaseSource({ ...input, journal: good, observedAt: "2026-09-16T00:00:06.000Z" });
  assert.equal(reorg.phase, "unknown_finality"); assert.equal(reorg.safeSourceProof, null);
});
test("all Circle intent fields and RPC origin must match the sealed call and receipt", async t => {
  const changes: Array<(intent: CircleV2BurnIntent) => CircleV2BurnIntent> = [
    i => ({ ...i, sourceTransactionHash: `0x${"ff".repeat(32)}` }),
    i => ({ ...i, sourceFrom: usdc }),
    i => ({ ...i, amountAtomic: "99999999" }),
    i => ({ ...i, solanaAtaBytes32: `0x${"cd".repeat(32)}` }),
    i => ({ ...i, maxFeeAtomic: "499999" }),
    i => ({ ...i, minFinalityThreshold: 999 }),
    i => ({ ...i, hookData: "0x12" }),
  ];
  for (const change of changes) {
    const f = await setup(); t.after(f.tmp.cleanup);
    const j = await reconcileCircleV2BaseSource({ journal: f.j, repository: f.repo, rpc: f.rpc,
      intent: change(f.intent), expectedRpcOrigin: origin, observedAt: at });
    assert.equal(j.phase, "unknown_finality"); assert.equal(j.safeSourceProof, null);
  }
  const f = await setup(); t.after(f.tmp.cleanup);
  const j = await reconcileCircleV2BaseSource({ journal: f.j, repository: f.repo, rpc: f.rpc,
    intent: f.intent, expectedRpcOrigin: "https://other.example", observedAt: at });
  assert.equal(j.phase, "unknown_finality");
});
