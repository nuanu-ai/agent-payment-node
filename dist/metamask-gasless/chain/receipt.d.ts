import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessIntent } from "../model.js";
import { type MmReceiptLog } from "./abi.js";
export interface MetaMaskGaslessAccounting {
    readonly deliveredAtomic: string;
    readonly feeAtomic: string;
    readonly debitAtomic: string;
    readonly firstTransferIndexAtomic: string;
    readonly secondTransferIndexAtomic: string;
    readonly counterIndexAtomic: string;
}
/** Validate complete receipt logs against the exact one-root/two-USDC-call settlement. */
export declare function verifyMetaMaskReceiptAccounting(intent: MetaMaskGaslessIntent, outerSender: Address, logs: readonly MmReceiptLog[]): MetaMaskGaslessAccounting;
/** Validate one scan log before treating its transaction hash as a candidate. */
export declare function verifyScanLog(value: Record<string, unknown>, intent: MetaMaskGaslessIntent, from: bigint, to: bigint): Hex;
