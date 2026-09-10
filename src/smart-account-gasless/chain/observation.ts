import { hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import type { Address, Hex } from "../../model.js";
import type { SmartAccountGaslessMaterialValidatorPort, SmartAccountGaslessObserveInput } from "../ports.js";
import type { SmartAccountGaslessBlock, SmartAccountGaslessCursor, SmartAccountGaslessObservation,
  SmartAccountGaslessRpcObservation, SmartAccountGaslessSettlement, SmartAccountGaslessUnusedProof } from "../model.js";
import { saFail, type SmartAccountGaslessReason } from "../reasons.js";
import { saExact, saHex, saHash, saIso } from "../schema.js";
import { saRegistry } from "../registry.js";
import { SaRpcBudgetError, SaRpcReorgError, parseReceiptLogs, quantity, receiptHash, recheckBlock,
  rpcAddress, rpcBlock, rpcHex, rpcQuantity, rpcRecord, type SaRpcCall } from "./abi.js";
import { verifySmartAccountOuterTransaction } from "./transaction.js";
import { verifySmartAccountRedemption } from "./redemption.js";
import { verifySmartAccountReceipt } from "./receipt.js";
import { advanceSmartAccountGaslessScan, validateSmartAccountGaslessCursor } from "./scan.js";
import { readSmartAccountGaslessProofState } from "./snapshot.js";

export interface SmartAccountObservationContext {
  readonly call: SaRpcCall;
  readonly clock: ClockPort;
  readonly validator: SmartAccountGaslessMaterialValidatorPort;
}

type Inspection =
  | { readonly kind: "success"; readonly settlement: SmartAccountGaslessSettlement }
  | { readonly kind: "pending"; readonly evidenceHash: string | null }
  | { readonly kind: "invalid" | "unavailable" | "reorg"; readonly evidenceHash: string | null };

/** One effect-free pass: bounded scans first, then one unambiguous signed transaction or finalized absence. */
export async function observeSmartAccountGasless(context: SmartAccountObservationContext,
  input: SmartAccountGaslessObserveInput): Promise<SmartAccountGaslessRpcObservation> {
  validateSmartAccountGaslessObserveInput(input);
  const originalCursor = validateSmartAccountGaslessCursor(input.intent, input.cursor);
  let safe: SmartAccountGaslessBlock, finalized: SmartAccountGaslessBlock;
  try {
    await recheckBlock(context.call, input.intent.initialSnapshot.preparationBlock, "sa_gasless_evidence", true);
    [safe, finalized] = await Promise.all([
      rpcBlock(context.call, "safe").then(value => value.block),
      rpcBlock(context.call, "finalized").then(value => value.block),
    ]);
    assertHeads(input.intent.initialSnapshot.preparationBlock, safe, finalized);
    if (BigInt(safe.numberAtomic) < BigInt(input.intent.initialSnapshot.preparationBlock.numberAtomic)) {
      await recheckBlock(context.call, safe, "sa_gasless_evidence", true);
      return observation(originalCursor, "pending", "sa_gasless_unknown", input.transactionHint,
        hashObject({ preparation: input.intent.initialSnapshot.preparationBlock, safe }), null, null, context.clock);
    }
  } catch (error) { return adverse(originalCursor, classify(error), context.clock); }

  let cursor: SmartAccountGaslessCursor;
  try {
    const scan = await advanceSmartAccountGaslessScan(context.call, input.intent,
      input.material.childDelegationHash, originalCursor, safe);
    cursor = scan.cursor;
    if (scan.partial) return observation(cursor, "pending", "sa_gasless_partial", null, scan.evidenceHash,
      null, null, context.clock);
  } catch (error) { return adverse(originalCursor, classify(error), context.clock); }

  if (cursor.candidateHashes.length > 1) {
    return observation(cursor, "pending", "sa_gasless_unknown", null,
      hashObject({ candidates: cursor.candidateHashes, ambiguous: true }), null, null, context.clock);
  }
  const discovered = cursor.candidateHashes[0] ?? null;
  if (discovered !== null) {
    const source = input.transactionHint === discovered ? "provider_hint" : "rpc_discovered";
    const inspected = await inspectSafely(context, input, discovered, safe, source);
    if (inspected.kind === "success") return success(cursor, inspected.settlement);
    return adverse(cursor, inspected, context.clock, discovered);
  }

  if (cursor.childScanComplete && cursor.transferScanComplete) {
    if (cursor.transferAnomalies.length === 0) {
      const unused = await unusedSafely(context, input, cursor, finalized);
      if (unused !== null) return unused;
    } else {
      return observation(cursor, "pending", "sa_gasless_unknown", null,
        hashObject({ transferAnomalies: cursor.transferAnomalies }), null, null, context.clock);
    }
  }

  if (input.transactionHint !== null) {
    // A completed zero-child scan contradicts a hinted positive receipt; never let the hint override it.
    if (cursor.childScanComplete) return observation(cursor, "invalid", "sa_gasless_evidence", null, null,
      null, null, context.clock);
    const inspected = await inspectSafely(context, input, input.transactionHint, safe, "provider_hint");
    if (inspected.kind === "success") return success(cursor, inspected.settlement);
    if (inspected.kind !== "pending") return adverse(cursor, inspected, context.clock, input.transactionHint);
  }
  return observation(cursor, "pending", "sa_gasless_unknown", input.transactionHint, null,
    null, null, context.clock);
}

async function inspectSafely(context: SmartAccountObservationContext, input: SmartAccountGaslessObserveInput,
  hash: Hex, safe: SmartAccountGaslessBlock, source: SmartAccountGaslessSettlement["source"]): Promise<Inspection> {
  try { return await inspectCandidate(context, input, hash, safe, source); }
  catch (error) {
    if (error instanceof SaRpcBudgetError) throw error;
    return classify(error);
  }
}

async function inspectCandidate(context: SmartAccountObservationContext, input: SmartAccountGaslessObserveInput,
  transactionHash: Hex, safe: SmartAccountGaslessBlock,
  source: SmartAccountGaslessSettlement["source"]): Promise<Inspection> {
  const [rawTransaction, rawReceipt] = await Promise.all([
    context.call("eth_getTransactionByHash", [transactionHash]),
    context.call("eth_getTransactionReceipt", [transactionHash]),
  ]);
  if (rawTransaction === null || rawReceipt === null) {
    return { kind: "pending", evidenceHash: hashObject({ transactionHash, pending: true }) };
  }
  const transaction = rpcRecord(rawTransaction), receipt = rpcRecord(rawReceipt);
  const blockNumber = rpcQuantity(receipt.blockNumber), blockHash = rpcHex(receipt.blockHash, 32, 32);
  const transactionIndex = rpcQuantity(receipt.transactionIndex), receiptType = rpcQuantity(receipt.type);
  if (rpcHex(receipt.transactionHash, 32, 32) !== transactionHash ||
    rpcHex(transaction.blockHash, 32, 32) !== blockHash || rpcQuantity(transaction.blockNumber) !== blockNumber ||
    rpcQuantity(transaction.transactionIndex) !== transactionIndex || rpcQuantity(transaction.type) !== receiptType) {
    saFail("sa_gasless_evidence");
  }
  if (BigInt(safe.numberAtomic) < blockNumber) {
    return { kind: "pending", evidenceHash: hashObject({ transactionHash, safe, blockNumber: blockNumber.toString() }) };
  }
  const includedRaw = await rpcBlock(context.call, quantity(blockNumber)), included = includedRaw.block;
  const transactions = includedRaw.raw.transactions;
  if (included.hash !== blockHash || !Array.isArray(transactions) || transactions.length > 20_000) {
    saFail("sa_gasless_evidence");
  }
  const transactionHashes = transactions.map(value => rpcHex(value, 32, 32));
  if (new Set(transactionHashes).size !== transactionHashes.length || transactionIndex >= BigInt(transactionHashes.length) ||
    transactionHashes[Number(transactionIndex)] !== transactionHash) saFail("sa_gasless_evidence");
  if (blockNumber < BigInt(input.intent.initialSnapshot.preparationBlock.numberAtomic) ||
    BigInt(included.timestampAtomic) <= BigInt(input.intent.afterUnix) ||
    BigInt(included.timestampAtomic) >= BigInt(input.intent.beforeUnix)) saFail("sa_gasless_evidence");
  const outer = await verifySmartAccountOuterTransaction(transaction, transactionHash, input.intent);
  const facilitator = input.intent.provider.facilitatorAddresses;
  if (!facilitator.includes(outer.from) || outer.from === input.intent.binding.ownerAddress ||
    outer.from === input.intent.binding.sessionAddress || outer.to !== input.intent.binding.delegationManager ||
    outer.valueAtomic !== "0" || rpcAddress(receipt.from) !== outer.from || rpcAddress(receipt.to) !== outer.to) {
    saFail("sa_gasless_evidence");
  }
  const status = rpcQuantity(receipt.status);
  if (status !== 0n && status !== 1n) saFail("sa_gasless_evidence");
  if (status === 0n) return { kind: "pending", evidenceHash: hashObject({ transactionHash, included, reverted: true }) };
  const redemption = await verifySmartAccountRedemption(outer.input, input.operationId, input.fingerprint,
    input.intent, input.material, context.validator);
  const logs = parseReceiptLogs(receipt.logs, transactionHash, included, transactionIndex);
  const accounting = verifySmartAccountReceipt(input.intent, outer.from, redemption, logs);
  const state = await readSmartAccountGaslessProofState(context.call, input.intent.binding,
    input.material.childDelegationHash, safe);
  if (state.childSpentAtomic !== input.intent.request.grossAtomic) saFail("sa_gasless_evidence");
  await recheckBlock(context.call, included, "sa_gasless_evidence", true);
  await recheckBlock(context.call, safe, "sa_gasless_evidence", true);
  await recheckBlock(context.call, input.intent.initialSnapshot.preparationBlock, "sa_gasless_evidence", true);
  const baseProof = { chainId: 8453, transactionHash, transactionBlock: included, finalityBlock: safe,
    transactionIndexAtomic: transactionIndex.toString(), outer };
  const settlement: SmartAccountGaslessSettlement = {
    observedAt: instant(context.clock), source, txHash: transactionHash, transactionBlock: included,
    finalityBlock: safe, finality: "safe", outerSender: outer.from,
    transactionProofHash: hashObject(baseProof), receiptHash: receiptHash(8453, transactionHash, included, status, logs),
    contextHash: input.material.permissionContextHash,
    protocolHash: hashObject({ deploymentEvidenceHash: input.intent.deploymentEvidenceHash, safe, state }),
    rootDelegationHash: input.material.rootDelegationHash, childDelegationHash: input.material.childDelegationHash,
    childSpentAtomic: state.childSpentAtomic, debitAtomic: accounting.debitAtomic,
    deliveredAtomic: accounting.deliveredAtomic, feeAtomic: "0", refundAtomic: "0", unusedGrossAtomic: "0",
    ownerNativeDebitWei: "0", sessionNativeDebitWei: "0",
  };
  return { kind: "success", settlement };
}

async function unusedSafely(context: SmartAccountObservationContext, input: SmartAccountGaslessObserveInput,
  cursor: SmartAccountGaslessCursor, finalized: SmartAccountGaslessBlock): Promise<SmartAccountGaslessRpcObservation | null> {
  const expiry = cursor.expiryBlock;
  if (expiry === null || BigInt(finalized.numberAtomic) < BigInt(expiry.numberAtomic) ||
    BigInt(finalized.timestampAtomic) < BigInt(input.intent.beforeUnix)) return null;
  try {
    const state = await readSmartAccountGaslessProofState(context.call, input.intent.binding,
      input.material.childDelegationHash, finalized);
    if (state.childSpentAtomic !== "0") return null;
    await recheckBlock(context.call, cursor.startBlock, "sa_gasless_evidence", true);
    if (cursor.previousEndBlock !== null) await recheckBlock(context.call, cursor.previousEndBlock,
      "sa_gasless_evidence", true);
    await recheckBlock(context.call, expiry, "sa_gasless_evidence", true);
    await recheckBlock(context.call, finalized, "sa_gasless_evidence", true);
    const proof: SmartAccountGaslessUnusedProof = { observedAt: instant(context.clock), startBlock: cursor.startBlock,
      expiryBlock: expiry, finalityBlock: finalized, childDelegationHash: input.material.childDelegationHash,
      childSpentAtomic: "0", childScanHash: hashObject({ start: cursor.startBlock, expiry,
        nextBlockAtomic: cursor.nextBlockAtomic, candidates: cursor.candidateHashes, complete: cursor.childScanComplete }),
      transferScanHash: hashObject({ start: cursor.startBlock, expiry, nextBlockAtomic: cursor.nextBlockAtomic,
        anomalies: cursor.transferAnomalies, complete: cursor.transferScanComplete }),
      anchorsHash: hashObject({ preparation: input.intent.initialSnapshot.preparationBlock,
        previousEnd: cursor.previousEndBlock, expiry, finalized }),
      protocolHash: hashObject({ deploymentEvidenceHash: input.intent.deploymentEvidenceHash, finalized, state }) };
    return observation(cursor, "expired_unused", null, null, hashObject(proof), null, proof, context.clock, proof.observedAt);
  } catch (error) {
    if (error instanceof SaRpcBudgetError) throw error;
    return adverse(cursor, classify(error), context.clock);
  }
}

function success(cursor: SmartAccountGaslessCursor,
  settlement: SmartAccountGaslessSettlement): SmartAccountGaslessRpcObservation {
  return { cursor, observation: { observedAt: settlement.observedAt, phase: "success", reason: null,
    candidateTxHash: settlement.txHash, evidenceHash: hashObject(settlement) }, settlement, unusedProof: null };
}

function adverse(cursor: SmartAccountGaslessCursor, inspected: Inspection, clock: ClockPort,
  candidate: Hex | null = null): SmartAccountGaslessRpcObservation {
  if (inspected.kind === "success") return success(cursor, inspected.settlement);
  const mapping: Record<Inspection["kind"], readonly [SmartAccountGaslessObservation["phase"], SmartAccountGaslessReason]> = {
    success: ["success", "sa_gasless_internal"], pending: ["pending", "sa_gasless_unknown"],
    invalid: ["invalid", "sa_gasless_evidence"], unavailable: ["unavailable", "sa_gasless_rpc_unavailable"],
    reorg: ["reorg", "sa_gasless_evidence"],
  };
  const [phase, reason] = mapping[inspected.kind];
  return observation(cursor, phase, reason, candidate, inspected.evidenceHash, null, null, clock);
}

function observation(cursor: SmartAccountGaslessCursor, phase: SmartAccountGaslessObservation["phase"],
  reason: SmartAccountGaslessReason | null, candidateTxHash: Hex | null, evidenceHash: string | null,
  settlement: SmartAccountGaslessSettlement | null, unusedProof: SmartAccountGaslessUnusedProof | null,
  clock: ClockPort, observedAt = instant(clock)): SmartAccountGaslessRpcObservation {
  return { cursor, observation: { observedAt, phase, reason, candidateTxHash, evidenceHash }, settlement, unusedProof };
}

function classify(error: unknown): Exclude<Inspection, { readonly kind: "success" }> {
  if (error instanceof SaRpcReorgError) return { kind: "reorg", evidenceHash: null };
  if (error instanceof SaRpcBudgetError) throw error;
  if (error instanceof ApnError && error.details?.reason === "sa_gasless_rpc_unavailable") {
    return { kind: "unavailable", evidenceHash: null };
  }
  return { kind: "invalid", evidenceHash: null };
}

export function validateSmartAccountGaslessObserveInput(input: SmartAccountGaslessObserveInput): void {
  saExact(input, ["operationId", "fingerprint", "intent", "material", "cursor", "transactionHint"]);
  const material = saExact(input.material, ["encodedRootHash", "encodedChildHash", "permissionContextHash",
    "payloadHash", "requirementsHash", "materialHash", "rootDelegationHash", "childDelegationHash", "sealedAt"]);
  if (typeof input.operationId !== "string" || input.operationId.length < 1 || input.operationId.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(input.operationId) || saHash(input.fingerprint) !== input.fingerprint) {
    saFail("sa_gasless_state_corrupt");
  }
  for (const key of ["encodedRootHash", "encodedChildHash", "permissionContextHash", "payloadHash",
    "requirementsHash", "materialHash"] as const) saHash(material[key]);
  saHex(material.rootDelegationHash, 32); saHex(material.childDelegationHash, 32); saIso(material.sealedAt);
  if (material.encodedRootHash !== input.intent.binding.encodedRootHash ||
    material.rootDelegationHash !== input.intent.binding.rootDelegationHash) saFail("sa_gasless_state_corrupt");
  if (input.transactionHint !== null) saHex(input.transactionHint, 32);
}

function assertHeads(start: SmartAccountGaslessBlock, safe: SmartAccountGaslessBlock,
  finalized: SmartAccountGaslessBlock): void {
  const safeNumber = BigInt(safe.numberAtomic), startNumber = BigInt(start.numberAtomic);
  if (BigInt(finalized.numberAtomic) > safeNumber || BigInt(finalized.timestampAtomic) > BigInt(safe.timestampAtomic) ||
    (safeNumber >= startNumber && BigInt(safe.timestampAtomic) < BigInt(start.timestampAtomic))) {
    saFail("sa_gasless_evidence");
  }
}

function instant(clock: ClockPort): string {
  const value = clock.now();
  if (!Number.isFinite(value.getTime())) saFail("sa_gasless_internal");
  return value.toISOString();
}
