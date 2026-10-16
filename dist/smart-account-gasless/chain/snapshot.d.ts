import type { ClockPort } from "../../ports.js";
import type { Hex } from "../../model.js";
import { type SmartAccountGaslessBinding, type SmartAccountGaslessBlock, type SmartAccountGaslessChainState, type SmartAccountGaslessIntent, type SmartAccountGaslessSnapshot } from "../model.js";
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
/** Protocol and token code pins this invocation already proved equal to the registry, reused by later guards. */
export type SmartAccountGaslessProvenPins = Pick<SmartAccountGaslessProofState, "protocolCodeHashes" | "tokenProxyCodeHash" | "tokenImplementationAddress" | "tokenImplementationCodeHash" | "tokenDomainSeparator" | "tokenDecimals">;
/**
 * Read every preparation identity and economic value at one captured numeric safe block. With `proven`, the protocol
 * and token code pins proven earlier in this operation's invocation are not downloaded again; the owner and session
 * code, balances, allowance and nonce are always read fresh.
 */
export declare function readSmartAccountGaslessChainState(call: SaRpcCall, bindingInput: SmartAccountGaslessBinding, block: SmartAccountGaslessBlock, proven?: SmartAccountGaslessProvenPins): Promise<SmartAccountGaslessChainState>;
/**
 * The settlement and unused proofs read only the child's spent amount at the current safe or finalized block. The
 * deployment identity in the proof is the pin set this operation froze at prepare (owner rule: an operation sent
 * before a pin change is proven against its own pins); code is not re-read, so a later token or protocol upgrade
 * never strands an operation that already moved money or provably did not.
 */
export declare function readSmartAccountGaslessProofState(call: SaRpcCall, intent: SmartAccountGaslessIntent, childHash: Hex, block: SmartAccountGaslessBlock): Promise<SmartAccountGaslessProofState>;
export declare function captureSmartAccountGaslessSnapshot(call: SaRpcCall, chainId: 8453, endpointOrigin: string, endpointHash: string, clock: ClockPort, bindingInput: SmartAccountGaslessBinding, proven?: SmartAccountGaslessProvenPins): Promise<SmartAccountGaslessSnapshot>;
/** Re-bind a later guard snapshot to the operation's immutable preparation anchor. */
export declare function recheckSmartAccountPreparation(call: SaRpcCall, expectedInput: SmartAccountGaslessBlock, currentPreparation: SmartAccountGaslessBlock): Promise<void>;
