import type { Address } from "../model.js";
import type { GaslessAccountState, GaslessBlock, GaslessDeployment, GaslessFeeConfiguration, GaslessIntent } from "./model.js";
import { type GaslessRpcCall } from "./rpc-codec.js";
/**
 * Proxy implementation slots and one-word identity calls are read at `block` every time. Code at a pinned address
 * cannot change after deployment (EIP-6780; upgrades move only the implementation slots read here), so a caller that
 * already verified the code hashes in this invocation passes `withCode: false` and skips the bytecode downloads.
 */
export declare function verifyProtocolAt(call: GaslessRpcCall, deployment: GaslessDeployment, block: GaslessBlock, withCode: boolean): Promise<void>;
type GaslessContracts = Pick<GaslessDeployment, "token" | "paymaster" | "entryPoint" | "delegate">;
/**
 * The contracts an already-sent operation is observed through are the ones its own intent saved, never today's
 * registry row: a later pin update cannot strand the proof of an operation sent under the earlier pin set.
 */
export declare function gaslessObservedContracts(intent: GaslessIntent): GaslessContracts;
export declare function readAccountAt(call: GaslessRpcCall, deployment: GaslessContracts, ownerInput: Address, block: GaslessBlock, readPending: boolean): Promise<GaslessAccountState>;
export declare function readFeeConfigurationAt(call: GaslessRpcCall, deployment: GaslessDeployment, owner: Address, block: GaslessBlock): Promise<GaslessFeeConfiguration>;
export declare function gasPrices(rawBaseFee: unknown, rawPriority: unknown): {
    readonly baseFeePerGas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
};
export {};
