import type { Hex } from "../../model.js";
import type { SmartAccountGaslessBlock, SmartAccountGaslessCursor, SmartAccountGaslessIntent } from "../model.js";
import { type SaRpcCall } from "./abi.js";
export declare const SA_SCAN_RANGE = 1999n;
export declare const SA_SCAN_LOG_LIMIT = 128;
export declare const SA_SCAN_CANDIDATE_LIMIT = 8;
export interface SmartAccountScanResult {
    readonly cursor: SmartAccountGaslessCursor;
    readonly partial: boolean;
    readonly evidenceHash: string;
}
export declare function initialSmartAccountGaslessCursor(intent: SmartAccountGaslessIntent): SmartAccountGaslessCursor;
export declare function validateSmartAccountGaslessCursor(intent: SmartAccountGaslessIntent, cursor: SmartAccountGaslessCursor): SmartAccountGaslessCursor;
/** Advance both exact-child and conservative transfer scans over one fully checked range. */
export declare function advanceSmartAccountGaslessScan(call: SaRpcCall, intent: SmartAccountGaslessIntent, childHash: Hex, cursorInput: SmartAccountGaslessCursor, safeHead: SmartAccountGaslessBlock): Promise<SmartAccountScanResult>;
