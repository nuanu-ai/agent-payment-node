import type { Address, Hex } from "../../model.js";
import { type SmartAccountGaslessBinding, type SmartAccountGaslessBlock } from "../model.js";
import { type SaRpcCall } from "./abi.js";
export interface SmartAccountAllowanceRead {
    readonly availableAtomic: string;
    readonly isNewPeriod: boolean;
    readonly currentPeriodAtomic: string;
}
export declare function validatePeriodTerms(binding: SmartAccountGaslessBinding): void;
/** Exact 96-byte return validation intentionally does not use a permissive ABI decoder. */
export declare function readCurrentAllowance(call: SaRpcCall, binding: SmartAccountGaslessBinding, block: SmartAccountGaslessBlock): Promise<SmartAccountAllowanceRead>;
export declare function readCurrentNonce(call: SaRpcCall, binding: SmartAccountGaslessBinding, block: SmartAccountGaslessBlock): Promise<string>;
export declare function readChildSpent(call: SaRpcCall, manager: Address, childHash: Hex, block: SmartAccountGaslessBlock): Promise<string>;
