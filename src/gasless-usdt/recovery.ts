import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address, Hex } from "../model.js";
import type { UsdtAnyBoundOperation as UsdtBoundOperation } from "./bound-operation.js";
import { validateUsdtStoredBoundOperation } from "./bound-stored.js";
import { UsdtExecutionJournal, type UsdtExecutionRecord } from "./execution-journal.js";
import { USDT_GASLESS } from "./model.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { restoreUsdtPlan } from "./restored-plan.js";
import { verifyUsdtReceipt, verifyUsdtRevert, type UsdtChainReceipt, type UsdtReceiptPins, type UsdtSettlement } from "./receipt.js";

/** Untrusted bundler locator. The chain receipt and its EntryPoint event remain the outcome authority. */
export interface UsdtUserOperationReceipt {
  readonly userOpHash: Hex;
  readonly sender: string;
  readonly entryPoint: string;
  readonly paymaster: string;
  readonly success: boolean;
  readonly transactionHash: Hex;
}
/** Canonical EntryPoint `UserOperationEvent` scan for one hash, sender and paymaster through Ethereum's finalized head. */
export interface UsdtUserOperationScanInput {
  readonly userOpHash: Hex;
  readonly sender: Address;
  /** The prepared safe block: the operation was signed later, so no earlier block can include it. */
  readonly fromBlock: bigint;
  readonly fromBlockHash: Hex;
  /** Signed paymaster `validUntil`; EntryPoint refuses the operation in any block with a later timestamp. */
  readonly validUntil: bigint;
  /** The record's own paymaster and EntryPoint (see `usdtRecordPins`). */
  readonly paymaster: Address;
  readonly entryPoint: Address;
}

/** The record's own token, signed paymaster and signed treasury; the EntryPoint its operation hash is bound to. */
export function usdtRecordPins(bound: UsdtBoundOperation): UsdtReceiptPins {
  const b = bound.binding;
  return { token: b.token as Address, paymaster: b.unsignedOperation.paymaster,
    treasury: decodeUsdtPaymasterData(b.paymasterData).treasury, entryPoint: USDT_GASLESS.entryPoint };
}
export type UsdtUserOperationScan =
  | { readonly status: "found"; readonly transactionHash: Hex }
  /**
   * `final` means the scan covered every block from `fromBlock` through a finalized block whose timestamp is after
   * `validUntil`, so the exact operation can never be included.
   */
  | { readonly status: "not_found"; readonly final: boolean; readonly finalizedBlock: bigint; readonly endBlock: bigint;
    readonly endBlockHash: Hex | null };
export interface UsdtRecoveryPort {
  userOperationReceipt(hash: Hex): Promise<UsdtUserOperationReceipt | null>;
  /** Returns a receipt only when its block is canonical and at or below Ethereum's finalized head. */
  canonicalFinalizedReceipt(transactionHash: Hex): Promise<UsdtChainReceipt | null>;
  scanUserOperation(input: UsdtUserOperationScanInput): Promise<UsdtUserOperationScan>;
}
type ObservedOutcome = { state: "finalized" | "failed_confirmed_revert"; digest: string; settlement: UsdtSettlement | null };

/** One bounded observation pass. It never signs, sends or retries a provider read. */
export class UsdtRecoveryService {
  constructor(private readonly journal: UsdtExecutionJournal, private readonly port: UsdtRecoveryPort,
    private readonly now: () => Date) {}

  async observe(value: UsdtBoundOperation): Promise<UsdtExecutionRecord> {
    // Observation only reads the chain for an existing hash, so the saved record is checked against itself (R2).
    const bound = validateUsdtStoredBoundOperation(value);
    const current = await this.journal.load(bound.operationId);
    if (current === null || current.bindingHash !== bound.binding.bindingHash ||
      current.profileHash !== bound.profileHash || current.sender !== bound.binding.plan.request.sender) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT recovery binding does not match.", { rail: "gasless_usdt" });
    }
    if (current.state === "finalized" || current.state === "failed_confirmed_revert" || current.state === "expired_never_landed") return current;
    if (current.userOperationHash === null || !["submitting", "submitted_pending", "unknown_finality"].includes(current.state)) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT has no submitted intent to observe.", { rail: "gasless_usdt" });
    }
    const hash = current.userOperationHash as Hex, pins = usdtRecordPins(bound);
    let outcome: ObservedOutcome | null = null;
    let neverLanded: Extract<UsdtUserOperationScan, { status: "not_found" }> | null = null;
    try {
      let candidate: Hex | null = null, contradicted = false;
      try {
        const locator = await this.port.userOperationReceipt(hash);
        if (locator !== null && locator.userOpHash.toLowerCase() === hash && locator.sender === current.sender &&
          locator.entryPoint === pins.entryPoint && locator.paymaster === pins.paymaster) candidate = locator.transactionHash;
      } catch { /* The bundler locator is only a hint; the canonical EntryPoint scan below does not depend on it. */ }
      if (candidate !== null) {
        const receipt = await this.port.canonicalFinalizedReceipt(candidate);
        // A receipt not yet finalized is pending; a finalized receipt without this operation's event contradicts the hint.
        if (receipt !== null) { outcome = this.proven(bound, current, hash, candidate, receipt, pins); contradicted = outcome === null; }
      }
      if (candidate === null || contradicted) {
        const scan = await this.port.scanUserOperation({ userOpHash: hash, sender: current.sender as Address,
          fromBlock: BigInt(current.safeBlockNumber), fromBlockHash: current.safeBlockHash as Hex,
          validUntil: BigInt(current.paymasterValidUntil), paymaster: pins.paymaster, entryPoint: pins.entryPoint });
        if (scan.status === "found") {
          const receipt = await this.port.canonicalFinalizedReceipt(scan.transactionHash);
          if (receipt !== null) outcome = this.proven(bound, current, hash, scan.transactionHash, receipt, pins);
        } else if (scan.final) neverLanded = scan;
      }
    } catch {
      // Missing, inconsistent, malformed and unavailable observations are never negative proof.
    }
    if (outcome !== null) return await this.journal.recordObservedOutcome(bound, outcome, this.now());
    if (neverLanded !== null) {
      const digest = hashObject({ operationId: bound.operationId, result: "expired_never_landed", userOpHash: hash,
        validUntil: current.paymasterValidUntil, fromBlock: current.safeBlockNumber, endBlock: neverLanded.endBlock.toString(),
        endBlockHash: neverLanded.endBlockHash, finalizedBlock: neverLanded.finalizedBlock.toString() });
      return await this.journal.recordNeverLanded(bound, digest, this.now());
    }
    return await this.journal.markUnknownFinality(bound, this.now());
  }

  /** The chain decides: exactly one successful event with the exact debits settles; one failed event is a confirmed revert. */
  private proven(bound: UsdtBoundOperation, current: UsdtExecutionRecord, hash: Hex, transactionHash: Hex,
    receipt: UsdtChainReceipt, pins: UsdtReceiptPins): ObservedOutcome | null {
    if (receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) return null;
    try {
      const settlement = verifyUsdtReceipt(restoreUsdtPlan(bound), hash, receipt, pins);
      return { state: "finalized", settlement, digest: hashObject({ operationId: bound.operationId, result: "finalized", settlement }) };
    } catch { /* Not a successful settlement of this operation; a failed event is checked next. */ }
    try {
      verifyUsdtRevert(current.sender as Address, hash, receipt, pins);
      return { state: "failed_confirmed_revert", settlement: null, digest: hashObject({ operationId: bound.operationId,
        result: "failed_confirmed_revert", transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), userOpHash: hash }) };
    } catch { return null; }
  }
}
