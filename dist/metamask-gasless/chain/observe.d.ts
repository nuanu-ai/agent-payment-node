import type { ClockPort } from "../../ports.js";
import type { MetaMaskGaslessCursor, MetaMaskGaslessDeployment, MetaMaskGaslessIntent, MetaMaskGaslessProviderObservation, MetaMaskGaslessRpcObservation } from "../model.js";
import { type MmRpcCall } from "./abi.js";
export interface MetaMaskObservationContext {
    readonly deployment: MetaMaskGaslessDeployment;
    readonly call: MmRpcCall;
    readonly clock: ClockPort;
}
/** Observe provider hints and the canonical enforcer log stream without any write/sign/send method. */
export declare function observeMetaMaskGasless(context: MetaMaskObservationContext, intent: MetaMaskGaslessIntent, cursorInput: MetaMaskGaslessCursor, provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation>;
