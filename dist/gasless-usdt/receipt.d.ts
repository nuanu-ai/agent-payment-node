import type { Hex } from "../model.js";
import { type UsdtTransferPlan } from "./model.js";
export interface UsdtReceiptLog {
    readonly address: string;
    readonly topics: readonly string[];
    readonly data: string;
}
export interface UsdtChainReceipt {
    readonly transactionHash: Hex;
    readonly blockNumber: bigint;
    readonly status: "success" | "reverted";
    readonly logs: readonly UsdtReceiptLog[];
}
/** Public accounting a completed transfer proves; nothing here comes from the bundler's own report. */
export interface UsdtSettlement {
    readonly transactionHash: Hex;
    readonly blockNumber: string;
    readonly userOpHash: Hex;
    /** N + A: the sender's whole USDT debit. */
    readonly senderDebitAtomic: string;
    /** A: the sponsor's charge, paid to the pinned treasury; 0 < A <= F. */
    readonly feeAtomic: string;
    /** N: the recipient's credit. */
    readonly recipientCreditAtomic: string;
    /** F - A, still approved to the pinned paymaster until the owner's next batch resets it. */
    readonly residualAllowanceAtomic: string;
    readonly actualGasCostWei: string;
}
/**
 * A receipt proves the payment only with exactly one successful UserOperationEvent for this hash, sender and paymaster,
 * exactly one USDT debit to the recipient of N, exactly one USDT debit to the treasury of A <= F, and no other USDT
 * leaving the sender in that transaction. Anything else is ambiguous and never closes the operation.
 */
export declare function verifyUsdtReceipt(plan: UsdtTransferPlan, userOpHash: Hex, receipt: UsdtChainReceipt): UsdtSettlement;
