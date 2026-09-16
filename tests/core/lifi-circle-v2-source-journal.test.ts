import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Encoder } from "@solana/kit";
import { encodeFunctionData, parseAbi } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import { bindCircleV2SourcePreparationToJournal } from "../../src/lifi/circle-v2-source-journal.js";
import type { CircleV2SourcePreparation } from "../../src/lifi/circle-v2-source-preparation.js";
import { NonEvmSourceJournalRepository } from "../../src/lifi/non-evm-source-journal.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { temporaryState } from "./helpers.js";

const abi = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const payer = "0x000000000000000000000000000000000000bEEF";
const refund = "0x000000000000000000000000000000000000dEaD";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wallet = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
const hook = "0x636374702d666f72776172640000000000000000000000000000000000000000";
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
async function fixture(): Promise<CircleV2SourcePreparation> {
  const ata = await associatedUsdc(wallet);
  const recipient = `0x${Buffer.from(getBase58Encoder().encode(ata)).toString("hex")}` as `0x${string}`;
  const data = encodeFunctionData({ abi, functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 5, recipient, token,
    `0x${"0".repeat(64)}`, hook, { signedQuote: "0x01020304", refundAddress: refund }] });
  const body = { kind: "circle_v2_base_source_preparation" as const, executionAdmitted: false as const,
    quoteAuthenticityVerified: false as const, baseStateSourceVerified: false as const, blockers: ["untrusted"],
    draftIntegrityDigest: `sha256:${"a".repeat(64)}`, quoteHash: `sha256:${"b".repeat(64)}`,
    quote: { signedQuote: "0x01020304", feeToken: token, feeTotalAtomic: "20000", expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 100 } },
    recipient: { wallet, ata, setup: "existing_ata" as const }, principalAtomic: "1000000", requiredUsdcDebitAtomic: "1020000", maxAllowanceAtomic: "1020000",
    sourceRefundAddress: refund, sourceBlock: { number: "99", hash: `0x${"c".repeat(64)}` },
    transaction: { type: "eip1559" as const, chainId: 8453 as const, from: payer, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
      data, valueAtomic: "0" as const, nonceAtomic: "7", gasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
      maxPriorityFeePerGasWei: "100000000" }, maximumNativeDebitWei: "200000000000000", l1DataFeeUpperWei: "0", operatorFeeUpperWei: "0",
    preparedAt: "2026-09-16T00:00:00.000Z", expiresAt: "2026-09-16T00:01:00.000Z" };
  return deepFreeze({ ...body, preparationDigest: `sha256:${hashObject(body)}` });
}
function input(preparation: CircleV2SourcePreparation) {
  return { preparation, route: "base_usdc_to_solana_usdc_circle_cctp_v2" as const, payer,
    draftIntegrityDigest: preparation.draftIntegrityDigest, preparationDigest: preparation.preparationDigest, profileHash: "d".repeat(64), operationId: "e".repeat(64),
    createdAt: "2026-09-16T00:00:00.000Z", admission: { claimedValidationHash: "f".repeat(64), note: "synthetic only",
      minFinalityThreshold: 1000 as const } };
}
function mutate(p: CircleV2SourcePreparation, change: (value: any) => void, redigest = false): CircleV2SourcePreparation {
  const v: any = structuredClone(p); change(v);
  if (redigest) { const { preparationDigest: _old, ...body } = v; v.preparationDigest = `sha256:${hashObject(body)}`; }
  return deepFreeze(v);
}
test("maps an immutable Circle source envelope with deterministic untrusted protocol input hash", async () => {
  const p = await fixture(), a = bindCircleV2SourcePreparationToJournal(input(p)), b = bindCircleV2SourcePreparationToJournal(input(p));
  assert.deepEqual(a, b);
  assert.equal(a.executionAdmitted, false);
  assert.equal(a.provenance, "synthetic_untrusted");
  assert.equal(a.binding.admissionProof.kind, "synthetic_untrusted");
  assert.equal(a.binding.admissionProof.claimedValidationHash, "f".repeat(64));
  assert.equal(a.binding.draftIntegrityHash, "a".repeat(64));
  assert.equal(a.binding.sourceCall.nonceAtomic, "7");
  assert.equal(a.binding.sourceCall.maxFeePerGasAtomic, "2000000000");
  assert.equal(a.binding.sourceCall.maxPriorityFeePerGasAtomic, "100000000");
  assert.equal(a.binding.sourceCall.dataSha256, sha256(Buffer.from(p.transaction.data.slice(2), "hex")));
  assert.deepEqual(a.binding.sourceCall.accessList, []);
  assert.equal(a.binding.maxSourceNativeDebitWei, "200000000000000");
  assert.match(a.protocolInputHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(a.binding).sort(), ["admissionProof", "createdAt", "draftIntegrityHash", "maxSourceNativeDebitWei", "operationId", "profileHash", "route", "sourceCall"].sort());
});
test("Circle projection stages its exact protocol hash in v2", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const projected = bindCircleV2SourcePreparationToJournal(input(await fixture()));
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  const j = await repo.stageV2({ ...projected.binding,
    schemaVersion: "apn.non-evm-source-journal.v2", protocolInputHash: projected.protocolInputHash });
  assert.equal(j.protocolInputHash, projected.protocolInputHash);
  assert.equal(j.executionAdmitted, false);
  const loaded = await new NonEvmSourceJournalRepository(tmp.root).load(j.profileHash, j.operationId);
  assert.equal(loaded?.schemaVersion, "apn.non-evm-source-journal.v2");
  if (loaded?.schemaVersion !== "apn.non-evm-source-journal.v2") throw new Error("missing v2");
  assert.equal(loaded.protocolInputHash, projected.protocolInputHash);
});
test("rejects altered digest, mutable preparation, wrong route payer draft and malformed hashes", async () => {
  const p = await fixture();
  assert.throws(() => bindCircleV2SourcePreparationToJournal(input(mutate(p, v => { v.transaction.nonceAtomic = "8"; }))), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => bindCircleV2SourcePreparationToJournal(input(structuredClone(p))), { code: "APN_OPERATION_BLOCKED" });
  for (const change of [
    (v: any) => { v.route = "base_usdc_to_tron_usdt_lifi_near_intents"; },
    (v: any) => { v.payer = refund; },
    (v: any) => { v.draftIntegrityDigest = `sha256:${"c".repeat(64)}`; },
    (v: any) => { v.profileHash = `sha256:${"d".repeat(64)}`; },
    (v: any) => { v.operationId = "ABC"; },
    (v: any) => { v.admission.claimedValidationHash = "0x" + "f".repeat(64); },
  ]) { const v: any = structuredClone(input(p)); change(v); assert.throws(() => bindCircleV2SourcePreparationToJournal(v), { code: "APN_OPERATION_BLOCKED" }); }
});
test("rejects fee, nonce, calldata and quote identity drift even after a recomputed digest", async () => {
  const p = await fixture();
  for (const change of [
    (v: any) => { v.transaction.nonceAtomic = "-1"; },
    (v: any) => { v.transaction.maxFeePerGasWei = "2000000001"; },
    (v: any) => { v.transaction.maxPriorityFeePerGasWei = "2000000001"; },
    (v: any) => { v.transaction.data = "0x"; },
    (v: any) => { v.quote.signedQuote = "0xdead"; },
    (v: any) => { v.recipient.ata = wallet; },
  ]) { const changed = mutate(p, change, true); assert.throws(() => bindCircleV2SourcePreparationToJournal(input(changed))); }
  const changed = bindCircleV2SourcePreparationToJournal({ ...input(p), admission: { ...input(p).admission, minFinalityThreshold: 2000 } });
  assert.notEqual(changed.protocolInputHash, bindCircleV2SourcePreparationToJournal(input(p)).protocolInputHash);
});

test("rejects re-digested call identity, native value, uint256 overflow and empty admission", async () => {
  const p = await fixture();
  const replacement = (change: (args: any[]) => void) => mutate(p, v => {
    const args: any[] = [1_000_000n, 5, `0x${Buffer.from(getBase58Encoder().encode(v.recipient.ata)).toString("hex")}`,
      token, `0x${"0".repeat(64)}`, hook, { signedQuote: v.quote.signedQuote, refundAddress: refund }];
    change(args);
    v.transaction.data = encodeFunctionData({ abi, functionName: "depositForBurnWithHookAndFees", args: args as never });
  }, true);
  for (const change of [
    (v: any) => { v.transaction.valueAtomic = "1"; },
    (v: any) => { v.maximumNativeDebitWei = "1"; },
    (v: any) => { v.transaction.nonceAtomic = (1n << 256n).toString(); },
    (v: any) => { v.transaction.gasLimitAtomic = (1n << 256n).toString(); },
    (v: any) => { v.maxAllowanceAtomic = "1019999"; },
    (v: any) => { v.maxAllowanceAtomic = ((1n << 256n) - 1n).toString(); },
  ]) { const changed = mutate(p, change, true); assert.throws(() => bindCircleV2SourcePreparationToJournal(input(changed))); }
  for (const change of [
    (args: any[]) => { args[0] = 1_000_001n; },
    (args: any[]) => { args[1] = 6; },
    (args: any[]) => { args[2] = `0x${"1".repeat(64)}`; },
    (args: any[]) => { args[3] = payer; },
    (args: any[]) => { args[4] = `0x${"1".repeat(64)}`; },
    (args: any[]) => { args[6] = { ...args[6], refundAddress: payer }; },
  ]) { const changed = replacement(change); assert.throws(() => bindCircleV2SourcePreparationToJournal(input(changed))); }
  assert.throws(() => bindCircleV2SourcePreparationToJournal({ ...input(p), admission: { ...input(p).admission, note: "" } }));
  assert.throws(() => bindCircleV2SourcePreparationToJournal({ ...input(p), admission: {} as any }));
});

test("binding has no journal stage, signing, sealing or submission effect", async () => {
  const p = await fixture();
  const methods = ["stage", "signingStarted", "seal", "committingSubmission"] as const;
  const original = methods.map(method => NonEvmSourceJournalRepository.prototype[method]);
  let invoked = 0;
  try {
    for (const method of methods) (NonEvmSourceJournalRepository.prototype as any)[method] = () => { invoked++; throw Error("journal called"); };
    const result = bindCircleV2SourcePreparationToJournal(input(p));
    assert.equal(result.executionAdmitted, false);
    assert.equal(invoked, 0);
  } finally {
    methods.forEach((method, index) => { (NonEvmSourceJournalRepository.prototype as any)[method] = original[index]; });
  }
});
