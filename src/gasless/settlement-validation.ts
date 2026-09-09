import { hashObject } from "../canonical.js";
import type { Hex } from "../model.js";
import type { GaslessAccountState, GaslessIntent, GaslessSettlement } from "./model.js";
import { settlementSchema } from "./schema.js";
import { gaslessFailure, gaslessSame, gaslessUint } from "./validation.js";

export function validateGaslessSettlement(i: GaslessIntent, userOperationHash: Hex, value: unknown): GaslessSettlement {
  if (!settlementSchema.safeParse(value).success) gaslessFailure("APN_STATE_CORRUPT", "gasless_settlement_shape");
  const p = value as GaslessSettlement, a = p.accounting;
  if (p.chainId !== i.request.chainId || p.userOperationHash !== userOperationHash || p.outerSender === i.owner.address ||
    p.protocolHash !== i.initialSnapshot.protocolHash || BigInt(p.block.numberAtomic) < BigInt(i.initialSnapshot.block.numberAtomic) ||
    BigInt(p.safeBlock.numberAtomic) < BigInt(p.block.numberAtomic) || BigInt(p.safeBlock.timestampAtomic) < BigInt(p.block.timestampAtomic) ||
    (p.safeBlock.numberAtomic === p.block.numberAtomic && !gaslessSame(p.safeBlock, p.block)) ||
    !consumed(i, p.effectAccount) || !consumed(i, p.safeAccount)) gaslessFailure("APN_STATE_CORRUPT", "gasless_settlement_binding");
  const prefund = gaslessUint(a.prefundAtomic, true), refund = gaslessUint(a.refundAtomic), fee = gaslessUint(a.feeAtomic);
  if (prefund > BigInt(i.feeCapAtomic) || refund > prefund || fee !== prefund - refund ||
    (a.success ? a.deliveredAtomic !== i.recipientAtomic || a.branch !== "sponsored" : a.deliveredAtomic !== "0") ||
    (a.branch !== "sponsored" && (a.success || refund !== 0n))) gaslessFailure("APN_STATE_CORRUPT", "gasless_settlement_economics");
  return p;
}
function consumed(i: GaslessIntent, a: GaslessAccountState): boolean {
  return a.owner === i.owner.address && a.delegation === "expected" &&
    BigInt(a.permitNonceAtomic) > BigInt(i.initialSnapshot.permitNonceAtomic) &&
    BigInt(a.entryPointNonceAtomic) > BigInt(i.initialSnapshot.entryPointNonceAtomic) &&
    BigInt(a.eoaNonceAtomic) >= BigInt(i.initialSnapshot.eoaNonceAtomic) + (i.initialSnapshot.delegation === "empty" ? 1n : 0n);
}
/** Later safe observations can establish cleanup, but cannot replace the proven effect. */
export function gaslessSettlementEffect(p: GaslessSettlement) {
  const { safeBlock: _safe, safeAccount: _account, ...effect } = p;
  return effect;
}
export function assertGaslessSettlementContinuation(previous: GaslessSettlement, next: GaslessSettlement): void {
  if (!gaslessSame(gaslessSettlementEffect(previous), gaslessSettlementEffect(next)) ||
    BigInt(next.safeBlock.numberAtomic) < BigInt(previous.safeBlock.numberAtomic) ||
    (next.safeBlock.numberAtomic === previous.safeBlock.numberAtomic && !gaslessSame(next, previous))) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_safe_proof_changed");
  }
}
export function gaslessSettlementHash(p: GaslessSettlement): string { return hashObject(p); }
