import type { ClockPort } from "../../ports.js";
import type { SmartAccountGaslessMaterialValidatorPort, SmartAccountGaslessObserveInput } from "../ports.js";
import type { SmartAccountGaslessRpcObservation } from "../model.js";
import { type SaRpcCall } from "./abi.js";
export interface SmartAccountObservationContext {
    readonly call: SaRpcCall;
    readonly clock: ClockPort;
    readonly validator: SmartAccountGaslessMaterialValidatorPort;
}
/** One effect-free pass: bounded scans first, then one unambiguous signed transaction or finalized absence. */
export declare function observeSmartAccountGasless(context: SmartAccountObservationContext, input: SmartAccountGaslessObserveInput): Promise<SmartAccountGaslessRpcObservation>;
export declare function validateSmartAccountGaslessObserveInput(input: SmartAccountGaslessObserveInput): void;
