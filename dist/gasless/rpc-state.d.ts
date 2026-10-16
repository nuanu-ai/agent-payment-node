import type { Address } from "../model.js";
import type { GaslessAccountState, GaslessBlock, GaslessDeployment, GaslessFeeConfiguration } from "./model.js";
import { type GaslessRpcCall } from "./rpc-codec.js";
/**
 * Proxy implementation slots and one-word identity calls are read at `block` every time. Code at a pinned address
 * cannot change after deployment (EIP-6780; upgrades move only the implementation slots read here), so a caller that
 * already verified the code hashes in this invocation passes `withCode: false` and skips the bytecode downloads.
 */
export declare function verifyProtocolAt(call: GaslessRpcCall, deployment: GaslessDeployment, block: GaslessBlock, withCode: boolean): Promise<void>;
export declare function readAccountAt(call: GaslessRpcCall, deployment: GaslessDeployment, ownerInput: Address, block: GaslessBlock, readPending: boolean): Promise<GaslessAccountState>;
export declare function readFeeConfigurationAt(call: GaslessRpcCall, deployment: GaslessDeployment, owner: Address, block: GaslessBlock): Promise<GaslessFeeConfiguration>;
export declare function gasPrices(rawBaseFee: unknown, rawPriority: unknown): {
    readonly baseFeePerGas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
};
