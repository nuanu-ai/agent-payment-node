import { hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessCursor, MetaMaskGaslessDeployment, MetaMaskGaslessIntent,
  MetaMaskGaslessObservation, MetaMaskGaslessProviderObservation, MetaMaskGaslessRpcObservation,
  MetaMaskGaslessSettlement } from "../model.js";
import { mmFail, type MetaMaskGaslessFailureReason, type MetaMaskGaslessReason } from "../reasons.js";
import { mmHex, mmSame, mmUint } from "../validation.js";
import { addressWord, MM_INCREASED_COUNT_TOPIC, parseReceiptLogs, quantity, receiptHash,
  recheckBlock, rpcAddress, rpcBlock, rpcHex, rpcQuantity, rpcRecord, sameBlock, type MmRpcCall } from "./abi.js";
import { verifyRedemption } from "./delegation.js";
import { verifyMetaMaskReceiptAccounting, verifyScanLog } from "./receipt.js";
import { readMetaMaskChainState } from "./snapshot.js";
import { verifyMetaMaskOuterTransaction } from "./transaction.js";

const SCAN_WINDOW = 2000n;
const MAX_SCAN_LOGS = 512;
const MAX_SCAN_CANDIDATES = 8;

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
  | { readonly kind: "invalid" | "unavailable" | "reorg"; readonly evidenceHash: string | null };

/** Observe provider hints and the canonical enforcer log stream without any write/sign/send method. */
export async function observeMetaMaskGasless(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  cursorInput: MetaMaskGaslessCursor, provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation> {
  const cursor = validateCursor(intent, cursorInput);
  const providerHash = provider?.txHash ?? null;
  let providerResult: Inspection | null = null;
  if (providerHash !== null) providerResult = await inspectSafely(context, intent, providerHash);
  if (providerResult?.kind === "success") return result(cursor, providerHash, providerResult, context.clock);

  const scan = await scanSafely(context, intent, cursor);
  if (scan.inspection?.kind === "success") return result(scan.cursor, scan.candidate, scan.inspection, context.clock);
  if (scan.inspection?.kind === "reverted") {
    return result(scan.cursor, scan.candidate, scan.inspection, context.clock);
  }
  if (providerResult?.kind === "reverted") return result(scan.cursor, providerHash, providerResult, context.clock);
  const adverse = chooseAdverse(scan.inspection, providerResult);
  // An invalid provider-hinted receipt also forbids advancing past the page.
  // Keep the original cursor until all relevant evidence can be validated.
  if (adverse !== null) return result(cursor, null, adverse, context.clock);
  const usableCandidate = scan.inspection?.kind === "pending" && scan.inspection.usableCandidate ? scan.candidate :
    providerResult?.kind === "pending" && providerResult.usableCandidate ? providerHash : null;
  return makeObservation(scan.cursor, "pending", "mm_gasless_pending", usableCandidate, null, null,
    scan.evidenceHash ?? providerResult?.evidenceHash ?? null, null, context.clock);
}

async function inspectSafely(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  transactionHash: Hex): Promise<Inspection> {
  try { return await inspectCandidate(context, intent, transactionHash); }
  catch (error) { return classified(error); }
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
  const accounting = status === 1n ? verifyMetaMaskReceiptAccounting(intent, outer.from, logs) : null;
  const receiptState = await readMetaMaskChainState(context.call, context.deployment.row,
    intent.binding.address, included, intent.delegationHash);
  if (!("counterAtomic" in receiptState) || receiptState.designation !== "pinned") {
    mmFail("mm_gasless_evidence_invalid");
  }
  const finality = (await rpcBlock(context.call, context.deployment.row.finalityTag)).block;
  if (BigInt(finality.numberAtomic) < blockNumber) {
    await recheckBlock(context.call, included); await recheckBlock(context.call, finality);
    return { kind: "pending", evidenceHash: hashObject({ transactionHash, included, finality }),
      usableCandidate: accounting !== null && receiptState.counterAtomic === "1" };
  }
  const finalityState = await readMetaMaskChainState(context.call, context.deployment.row,
    intent.binding.address, finality, intent.delegationHash);
  if (!("counterAtomic" in finalityState) || finalityState.designation !== "pinned") mmFail("mm_gasless_evidence_invalid");
  await recheckBlock(context.call, included); await recheckBlock(context.call, finality);
  const baseProof = { chainId: intent.request.chainId, transactionHash, transactionBlock: included,
    finalityBlock: finality, transactionIndexAtomic: transactionIndex.toString(), outer };
  if (status === 0n) {
    if (receiptState.counterAtomic !== "0" || finalityState.counterAtomic !== "0") {
      return { kind: "pending", evidenceHash: hashObject({ ...baseProof, counterAdvancedAfterRevert: true }),
        usableCandidate: false };
    }
    return { kind: "reverted", transactionBlock: included, finalityBlock: finality,
      evidenceHash: hashObject({ ...baseProof, status: "reverted" }) };
  }
  if (receiptState.counterAtomic !== "1" || finalityState.counterAtomic !== "1") mmFail("mm_gasless_evidence_invalid");
  if (accounting === null) mmFail("mm_gasless_internal");
  const observedAt = context.clock.now().toISOString();
  const transactionProofHash = hashObject(baseProof);
  const protocolHash = hashObject({ deploymentEvidenceHash: context.deployment.deploymentEvidenceHash,
    receipt: { block: included, code: receiptState.protocolCodeHashes },
    finality: { block: finality, code: finalityState.protocolCodeHashes } });
  const tokenImplementationHash = hashObject({ token: context.deployment.row.token,
    receipt: { block: included, address: receiptState.tokenImplementationAddress,
      codeHash: receiptState.tokenImplementationCodeHash, proxyCodeHash: receiptState.tokenProxyCodeHash },
    finality: { block: finality, address: finalityState.tokenImplementationAddress,
      codeHash: finalityState.tokenImplementationCodeHash, proxyCodeHash: finalityState.tokenProxyCodeHash } });
  const settlement: MetaMaskGaslessSettlement = {
    observedAt, txHash: transactionHash, transactionBlock: included, finalityBlock: finality,
    outerSender: outer.from, transactionProofHash,
    receiptHash: receiptHash(intent.request.chainId, transactionHash, included, status, logs),
    protocolHash, tokenImplementationHash, deliveredAtomic: accounting.deliveredAtomic,
    feeAtomic: accounting.feeAtomic, debitAtomic: accounting.debitAtomic, refundAtomic: "0",
    unusedGrossAtomic: "0", designation: "pinned", permission: "consumed",
    receiptCounterAtomic: "1", finalityCounterAtomic: "1",
  };
  return { kind: "success", settlement };
}

async function scanSafely(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  cursor: MetaMaskGaslessCursor): Promise<{ readonly cursor: MetaMaskGaslessCursor; readonly candidate: Hex | null;
    readonly inspection: Inspection | null; readonly evidenceHash: string | null }> {
  try { return await scan(context, intent, cursor); }
  catch (error) { return { cursor, candidate: null, inspection: classified(error), evidenceHash: null }; }
}

async function scan(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent,
  cursor: MetaMaskGaslessCursor): Promise<{ readonly cursor: MetaMaskGaslessCursor; readonly candidate: Hex | null;
    readonly inspection: Inspection | null; readonly evidenceHash: string | null }> {
  await recheckBlock(context.call, cursor.startBlock);
  if (cursor.previousEndBlock !== null) await recheckBlock(context.call, cursor.previousEndBlock);
  const finality = (await rpcBlock(context.call, context.deployment.row.finalityTag)).block;
  const start = BigInt(cursor.nextBlockAtomic), finalityNumber = BigInt(finality.numberAtomic);
  if (finalityNumber < start) {
    await recheckBlock(context.call, finality);
    return { cursor, candidate: null, inspection: null, evidenceHash: hashObject({ cursor, finality, empty: true }) };
  }
  const end = minimum(finalityNumber, start + SCAN_WINDOW - 1n);
  const [startBlock, endBlock] = await Promise.all([
    rpcBlock(context.call, quantity(start)).then(value => value.block),
    rpcBlock(context.call, quantity(end)).then(value => value.block),
  ]);
  const row = context.deployment.row;
  const filter = { address: row.protocol.limitedCalls.address, fromBlock: quantity(start), toBlock: quantity(end),
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address), null, intent.delegationHash] };
  const rawLogs = await context.call("eth_getLogs", [filter]);
  if (!Array.isArray(rawLogs) || rawLogs.length > MAX_SCAN_LOGS) mmFail("mm_gasless_evidence_invalid");
  const candidates = new Set<Hex>();
  for (const raw of rawLogs) candidates.add(verifyScanLog(rpcRecord(raw), intent, start, end));
  if (candidates.size > MAX_SCAN_CANDIDATES) mmFail("mm_gasless_evidence_invalid");
  const inspections: Array<{ readonly hash: Hex; readonly result: Inspection }> = [];
  for (const hash of candidates) inspections.push({ hash, result: await inspectSafely(context, intent, hash) });
  await recheckBlock(context.call, startBlock); await recheckBlock(context.call, endBlock);
  await recheckBlock(context.call, finality);
  if (candidates.size > 1) mmFail("mm_gasless_evidence_invalid");
  const inspected = inspections[0];
  if (inspected !== undefined) return { cursor, candidate: inspected.hash, inspection: inspected.result,
    evidenceHash: inspected.result.kind === "success" ? hashObject(inspected.result.settlement) : inspected.result.evidenceHash };
  const nextCursor = { startBlock: cursor.startBlock, nextBlockAtomic: (end + 1n).toString(), previousEndBlock: endBlock };
  return { cursor: nextCursor, candidate: null, inspection: null,
    evidenceHash: hashObject({ filter, startBlock, endBlock, finality, complete: true }) };
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
    if (reason === "mm_gasless_rpc_unavailable") return { kind: "unavailable", evidenceHash: null };
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
  const [phase, reason] = map[inspected.kind];
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

function minimum(left: bigint, right: bigint): bigint { return left < right ? left : right; }
