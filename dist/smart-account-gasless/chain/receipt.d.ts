import type { Address, Hex } from "../../model.js";
import type { SmartAccountGaslessIntent } from "../model.js";
import { type SaReceiptLog } from "./abi.js";
import type { VerifiedSmartAccountRedemption } from "./redemption.js";
export interface SmartAccountReceiptAccounting {
    readonly debitAtomic: string;
    readonly deliveredAtomic: string;
    readonly transferIndexAtomic: string;
    readonly childSpentIndexAtomic: string;
    readonly redemptionIndexesAtomic: readonly [string, string];
}
/** Validate the full canonical receipt against the one exact child/root redemption and one USDC transfer. */
export declare function verifySmartAccountReceipt(intent: SmartAccountGaslessIntent, outerSender: Address, redemption: VerifiedSmartAccountRedemption, logs: readonly SaReceiptLog[]): SmartAccountReceiptAccounting;
export declare function verifyChildScanLog(value: Record<string, unknown>, intent: SmartAccountGaslessIntent, childHash: Hex, from: bigint, to: bigint): Hex;
export declare function verifyTransferScanLog(value: Record<string, unknown>, intent: SmartAccountGaslessIntent, from: bigint, to: bigint): Hex | null;
