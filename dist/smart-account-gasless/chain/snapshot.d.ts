import type { ClockPort } from "../../ports.js";
import type { Hex } from "../../model.js";
import { type SmartAccountGaslessBinding, type SmartAccountGaslessBlock, type SmartAccountGaslessChainState, type SmartAccountGaslessSnapshot } from "../model.js";
import { type SaRpcCall } from "./abi.js";
export interface SmartAccountGaslessProofState {
    readonly protocolCodeHashes: SmartAccountGaslessChainState["protocolCodeHashes"];
    readonly ownerCodeHash: Hex;
    readonly sessionCodeHash: Hex;
    readonly tokenProxyCodeHash: Hex;
    readonly tokenImplementationAddress: SmartAccountGaslessChainState["tokenImplementationAddress"];
    readonly tokenImplementationCodeHash: Hex;
    readonly tokenDomainSeparator: Hex;
    readonly tokenDecimals: 6;
    readonly childSpentAtomic: string;
}
/** Read every preparation identity and economic value at one captured numeric safe block. */
export declare function readSmartAccountGaslessChainState(call: SaRpcCall, bindingInput: SmartAccountGaslessBinding, block: SmartAccountGaslessBlock): Promise<SmartAccountGaslessChainState>;
/** Historical proof deliberately omits current allowance and nonce validity. */
export declare function readSmartAccountGaslessProofState(call: SaRpcCall, binding: SmartAccountGaslessBinding, childHash: Hex, block: SmartAccountGaslessBlock): Promise<SmartAccountGaslessProofState>;
export declare function captureSmartAccountGaslessSnapshot(call: SaRpcCall, chainId: 8453, endpointOrigin: string, endpointHash: string, clock: ClockPort, bindingInput: SmartAccountGaslessBinding): Promise<SmartAccountGaslessSnapshot>;
/** Re-bind a later guard snapshot to the operation's immutable preparation anchor. */
export declare function recheckSmartAccountPreparation(call: SaRpcCall, expectedInput: SmartAccountGaslessBlock, currentPreparation: SmartAccountGaslessBlock): Promise<void>;
