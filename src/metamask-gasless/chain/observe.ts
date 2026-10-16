import { mmUnusedGross } from "../economics.js";
import { hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessCursor, MetaMaskGaslessDeployment, MetaMaskGaslessIntent,
  MetaMaskGaslessObservation, MetaMaskGaslessProviderObservation, MetaMaskGaslessRpcObservation,
  MetaMaskGaslessSettlement } from "../model.js";
import { mmFail, type MetaMaskGaslessFailureReason, type MetaMaskGaslessReason } from "../reasons.js";
import { mmHex, mmUint } from "../validation.js";
import { parseReceiptLogs, quantity, receiptHash, recheckBlock, rpcAddress, rpcBlock, rpcHex, rpcQuantity, rpcRecord,
  sameBlock, type MmRpcCall } from "./abi.js";
import { verifyRedemption } from "./delegation.js";
import { verifyMetaMaskReceiptAccounting } from "./receipt.js";
import { MM_SCAN_STOP_REASONS, mmRedemptionCount, scanMetaMaskRedemption } from "./scan.js";
import { mmProtocolPins } from "../single-protocol.js";
import { verifyMetaMaskOuterTransaction } from "./transaction.js";

export interface MetaMaskObservationContext {
  readonly deployment: MetaMaskGaslessDeployment;
  readonly call: MmRpcCall;
  readonly clock: ClockPort;
}

type Inspection =
  | { readonly kind: "success"; readonly settlement: MetaMaskGaslessSettlement }
  | { readonly kind: "reverted"; readonly transactionBlock: MetaMaskGaslessSettlement["transactionBlock"];
      readonly finalityBlock: MetaMaskGaslessSettlement["finalityBlock"]; readonly evidenceHash: string }
  | { readonly kind: "pending"; readonly evidenceHash: string | null; readonly usableCandidate: boolean }
  | { readonly kind: "invalid" | "reorg"; readonly evidenceHash: string | null }
  | { readonly kind: "unavailable"; readonly evidenceHash: string | null; readonly reason: MetaMaskGaslessFailureReason };

/** Observe provider hints and the canonical enforcer log stream without any write/sign/send method. */
export async function observeMetaMaskGasless(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  cursorInput: MetaMaskGaslessCursor, provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation> {
  const cursor = validateCursor(intent, cursorInput);
  const providerHash = provider?.txHash ?? null;
  // One pass inspects a transaction hash once, whether the provider hinted it or the scan found it.
  const inspected = new Map<Hex, Inspection>();
  let providerResult: Inspection | null = null;
  if (providerHash !== null) providerResult = await inspectSafely(context, intent, providerHash, inspected);
  if (providerResult?.kind === "success") return result(cursor, providerHash, providerResult, context.clock);

  const scan = await scanSafely(context, intent, cursor, inspected);
  if (scan.inspection?.kind === "success") return result(scan.cursor, scan.candidate, scan.inspection, context.clock);
  if (scan.inspection?.kind === "reverted") {
    return result(scan.cursor, scan.candidate, scan.inspection, context.clock);
  }
  if (providerResult?.kind === "reverted") return result(scan.cursor, providerHash, providerResult, context.clock);
  const adverse = chooseAdverse(scan.inspection, providerResult);
  // An invalid provider-hinted receipt also forbids advancing past the page, and so does any invalid or reorged
  // scan evidence: keep the original cursor until all relevant evidence can be validated. Blocks this resume fully
  // proved before the RPC stopped answering stay proved.
  if (adverse !== null) return result(adverse === scan.inspection && adverse.kind === "unavailable" ? scan.cursor : cursor,
    null, adverse, context.clock);
  const usableCandidate = scan.inspection?.kind === "pending" && scan.inspection.usableCandidate ? scan.candidate :
    providerResult?.kind === "pending" && providerResult.usableCandidate ? providerHash : null;
  return makeObservation(scan.cursor, "pending", "mm_gasless_pending", usableCandidate, null, null,
    scan.evidenceHash ?? providerResult?.evidenceHash ?? null, null, context.clock);
}

async function inspectSafely(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  transactionHash: Hex, inspected: Map<Hex, Inspection>): Promise<Inspection> {
  const known = inspected.get(transactionHash);
  if (known !== undefined) return known;
  let result: Inspection;
  try { result = await inspectCandidate(context, intent, transactionHash); }
  catch (error) { result = classified(error); }
  inspected.set(transactionHash, result);
  return result;
}

async function inspectCandidate(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  transactionHash: Hex): Promise<Inspection> {
  const [rawTransaction, rawReceipt] = await Promise.all([
    context.call("eth_getTransactionByHash", [transactionHash]),
    context.call("eth_getTransactionReceipt", [transactionHash]),
  ]);
  if (rawTransaction === null || rawReceipt === null) {
    return { kind: "pending", evidenceHash: hashObject({ transactionHash, pending: true }), usableCandidate: false };
  }
  const transaction = rpcRecord(rawTransaction), receipt = rpcRecord(rawReceipt);
  const blockNumber = rpcQuantity(receipt.blockNumber), blockHash = rpcHex(receipt.blockHash, 32, 32);
  const transactionIndex = rpcQuantity(receipt.transactionIndex), receiptType = rpcQuantity(receipt.type);
  if (rpcHex(receipt.transactionHash, 32, 32) !== transactionHash ||
    rpcHex(transaction.blockHash, 32, 32) !== blockHash || rpcQuantity(transaction.blockNumber) !== blockNumber ||
    rpcQuantity(transaction.transactionIndex) !== transactionIndex || rpcQuantity(transaction.type) !== receiptType) {
    mmFail("mm_gasless_evidence_invalid");
  }
  const includedRaw = await rpcBlock(context.call, quantity(blockNumber)), included = includedRaw.block;
  const transactions = includedRaw.raw.transactions;
  if (included.hash !== blockHash || !Array.isArray(transactions) || transactions.length > 20_000 ||
    transactionIndex >= BigInt(transactions.length) ||
    rpcHex(transactions[Number(transactionIndex)], 32, 32) !== transactionHash) mmFail("mm_gasless_evidence_invalid");
  const outer = await verifyMetaMaskOuterTransaction(transaction, transactionHash, intent);
  if (outer.to !== context.deployment.row.protocol.manager.address || outer.valueAtomic !== "0" ||
    outer.from === intent.binding.address || rpcAddress(receipt.from) !== outer.from ||
    rpcAddress(receipt.to) !== outer.to) mmFail("mm_gasless_evidence_invalid");
  await verifyRedemption(outer.input, intent);
  const logs = parseReceiptLogs(receipt.logs, transactionHash, included, transactionIndex);
  const status = rpcQuantity(receipt.status);
  if (status !== 0n && status !== 1n) mmFail("mm_gasless_evidence_invalid");
  // The receipt's own IncreasedCount(limit 1, count 1) for this delegation proves the redemption at inclusion, so no
  // state is read at the inclusion block: that would be an archive read once the operation is older than the
  // RPC's state window, and the operation would stay unknown for ever.
  const accounting = status === 1n ? verifyMetaMaskReceiptAccounting(intent, outer.from, logs) : null;
  const finality = (await rpcBlock(context.call, context.deployment.row.finalityTag)).block;
  if (BigInt(finality.numberAtomic) < blockNumber) {
    await recheckBlock(context.call, included); await recheckBlock(context.call, finality);
    return { kind: "pending", evidenceHash: hashObject({ transactionHash, included, finality }),
      usableCandidate: accounting !== null };
  }
  // At the canonical finality block, pinned by hash: the redemption count and the owner's pinned 7702 designation.
  const counter = await mmRedemptionCount({ row: context.deployment.row, call: context.call }, intent.delegationHash, finality);
  const ownerCode = rpcHex(await context.call("eth_getCode", [intent.binding.address,
    { blockHash: finality.hash, requireCanonical: true }]), 32 * 1024);
  if (ownerCode !== `0xef0100${context.deployment.row.protocol.delegate.address.slice(2)}`) mmFail("mm_gasless_evidence_invalid");
  await recheckBlock(context.call, included); await recheckBlock(context.call, finality);
  const baseProof = { chainId: intent.request.chainId, transactionHash, transactionBlock: included,
    finalityBlock: finality, transactionIndexAtomic: transactionIndex.toString(), outer };
  if (status === 0n) {
    // The count never decreases: 0 at the canonical finality block means the delegation was never redeemed.
    if (counter !== 0n) {
      return { kind: "pending", evidenceHash: hashObject({ ...baseProof, counterAdvancedAfterRevert: true }),
        usableCandidate: false };
    }
    return { kind: "reverted", transactionBlock: included, finalityBlock: finality,
      evidenceHash: hashObject({ ...baseProof, status: "reverted" }) };
  }
  if (counter !== 1n) mmFail("mm_gasless_evidence_invalid");
  if (accounting === null) mmFail("mm_gasless_internal");
  const observedAt = context.clock.now().toISOString();
  const transactionProofHash = hashObject(baseProof);
  // Provenance of the deployment the evidence was checked against, computed from its pins.
  const row = context.deployment.row;
  const code = Object.fromEntries(Object.entries(mmProtocolPins(row, intent.quote.feeMode)).map(([name, pin]) => [name, pin.codeHash]));
  const protocolHash = hashObject({ deploymentEvidenceHash: context.deployment.deploymentEvidenceHash,
    receipt: { block: included, code }, finality: { block: finality, code } });
  const tokenState = { address: row.tokenImplementationAddress, codeHash: row.tokenImplementationCodeHash, proxyCodeHash: row.tokenProxyCodeHash };
  const tokenImplementationHash = hashObject({ token: row.token,
    receipt: { block: included, ...tokenState }, finality: { block: finality, ...tokenState } });
  const settlement: MetaMaskGaslessSettlement = {
    observedAt, txHash: transactionHash, transactionBlock: included, finalityBlock: finality,
    outerSender: outer.from, transactionProofHash,
    receiptHash: receiptHash(intent.request.chainId, transactionHash, included, status, logs),
    protocolHash, tokenImplementationHash, deliveredAtomic: accounting.deliveredAtomic,
    feeAtomic: accounting.feeAtomic, debitAtomic: accounting.debitAtomic, refundAtomic: "0",
    unusedGrossAtomic: mmUnusedGross(intent.request, intent.quote), designation: "pinned", permission: "consumed",
    receiptCounterAtomic: "1", finalityCounterAtomic: "1",
  };
  return { kind: "success", settlement };
}

async function scanSafely(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  cursor: MetaMaskGaslessCursor, memo: Map<Hex, Inspection>): Promise<{ readonly cursor: MetaMaskGaslessCursor; readonly candidate: Hex | null;
    readonly inspection: Inspection | null; readonly evidenceHash: string | null }> {
  try {
    const scanned = await scanMetaMaskRedemption({ row: context.deployment.row, call: context.call }, intent, cursor);
    if (scanned.kind === "progress") return { cursor: scanned.cursor, candidate: null, inspection: null, evidenceHash: scanned.evidenceHash };
    if (scanned.kind === "stopped") return { cursor: scanned.cursor, candidate: null,
      inspection: { kind: "unavailable", evidenceHash: null, reason: scanned.reason }, evidenceHash: null };
    const inspections: Array<{ readonly hash: Hex; readonly result: Inspection }> = [];
    for (const hash of scanned.candidates) inspections.push({ hash, result: await inspectSafely(context, intent, hash, memo) });
    for (const block of scanned.recheck) await recheckBlock(context.call, block);
    if (inspections.length !== 1) mmFail("mm_gasless_evidence_invalid");
    const inspected = inspections[0]!;
    return { cursor: scanned.cursor, candidate: inspected.hash, inspection: inspected.result,
      evidenceHash: inspected.result.kind === "success" ? hashObject(inspected.result.settlement) : inspected.result.evidenceHash };
  } catch (error) { return { cursor, candidate: null, inspection: classified(error), evidenceHash: null }; }
}

function validateCursor(intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor): MetaMaskGaslessCursor {
  validateBlock(cursor.startBlock); const next = mmUint(cursor.nextBlockAtomic, false, "mm_gasless_state_corrupt");
  if (!sameBlock(cursor.startBlock, intent.initialSnapshot.safeBlock) || next < BigInt(cursor.startBlock.numberAtomic)) {
    mmFail("mm_gasless_state_corrupt");
  }
  if (cursor.previousEndBlock === null) {
    if (next !== BigInt(cursor.startBlock.numberAtomic)) mmFail("mm_gasless_state_corrupt");
  } else {
    validateBlock(cursor.previousEndBlock);
    if (BigInt(cursor.previousEndBlock.numberAtomic) < BigInt(cursor.startBlock.numberAtomic) ||
      next !== BigInt(cursor.previousEndBlock.numberAtomic) + 1n) mmFail("mm_gasless_state_corrupt");
  }
  return cursor;
}

function validateBlock(block: MetaMaskGaslessCursor["startBlock"]): void {
  mmUint(block.numberAtomic, false, "mm_gasless_state_corrupt");
  mmUint(block.timestampAtomic, false, "mm_gasless_state_corrupt");
  if (mmHex(block.hash, 32, "mm_gasless_state_corrupt") !== block.hash) mmFail("mm_gasless_state_corrupt");
}

function classified(error: unknown): Inspection {
  if (error instanceof ApnError && typeof error.details?.reason === "string") {
    const reason = error.details.reason as MetaMaskGaslessFailureReason;
    if (reason === "mm_gasless_scan_reorg") return { kind: "reorg", evidenceHash: null };
    if (MM_SCAN_STOP_REASONS.includes(reason)) return { kind: "unavailable", evidenceHash: null, reason };
  }
  return { kind: "invalid", evidenceHash: null };
}

function chooseAdverse(...values: readonly (Inspection | null)[]): Inspection | null {
  for (const kind of ["reorg", "invalid", "unavailable"] as const) {
    const found = values.find(value => value?.kind === kind);
    if (found !== undefined && found !== null) return found;
  }
  return null;
}

function result(cursor: MetaMaskGaslessCursor, candidate: Hex | null,
  inspected: Inspection, clock: ClockPort): MetaMaskGaslessRpcObservation {
  if (inspected.kind === "success") return { cursor, observation: {
    observedAt: inspected.settlement.observedAt, phase: "success", reason: "mm_gasless_success",
    candidateTxHash: inspected.settlement.txHash, transactionBlock: inspected.settlement.transactionBlock,
    finalityBlock: inspected.settlement.finalityBlock, evidenceHash: hashObject(inspected.settlement),
  }, settlement: inspected.settlement };
  if (inspected.kind === "reverted") return makeObservation(cursor, "reverted", "mm_gasless_transaction_reverted",
    candidate, inspected.transactionBlock, inspected.finalityBlock, inspected.evidenceHash, null, clock);
  const map: Record<"invalid" | "unavailable" | "reorg" | "pending", readonly [MetaMaskGaslessObservation["phase"], MetaMaskGaslessReason]> = {
    invalid: ["invalid", "mm_gasless_evidence_invalid"], unavailable: ["unavailable", "mm_gasless_rpc_unavailable"],
    reorg: ["reorg", "mm_gasless_scan_reorg"], pending: ["pending", "mm_gasless_pending"],
  };
  const [phase, mapped] = map[inspected.kind];
  const reason = inspected.kind === "unavailable" ? inspected.reason : mapped;
  return makeObservation(cursor, phase, reason, candidate, null, null, inspected.evidenceHash, null, clock);
}

function makeObservation(cursor: MetaMaskGaslessCursor, phase: MetaMaskGaslessObservation["phase"],
  reason: MetaMaskGaslessReason, candidateTxHash: Hex | null,
  transactionBlock: MetaMaskGaslessObservation["transactionBlock"],
  finalityBlock: MetaMaskGaslessObservation["finalityBlock"], evidenceHash: string | null,
  settlement: MetaMaskGaslessSettlement | null, clock: ClockPort): MetaMaskGaslessRpcObservation {
  return { cursor, observation: { observedAt: clock.now().toISOString(), phase, reason, candidateTxHash,
    transactionBlock, finalityBlock, evidenceHash }, settlement };
}

