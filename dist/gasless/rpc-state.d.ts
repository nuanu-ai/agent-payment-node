import type { Address } from "../model.js";
import type { GaslessAccountState, GaslessBlock, GaslessDeployment, GaslessFeeConfiguration } from "./model.js";
import { type GaslessRpcCall } from "./rpc-codec.js";
export declare function verifyProtocolAt(call: GaslessRpcCall, deployment: GaslessDeployment, block: GaslessBlock): Promise<void>;
export declare function readAccountAt(call: GaslessRpcCall, deployment: GaslessDeployment, ownerInput: Address, block: GaslessBlock, readPending: boolean): Promise<GaslessAccountState>;
export declare function readFeeConfigurationAt(call: GaslessRpcCall, deployment: GaslessDeployment, owner: Address, block: GaslessBlock): Promise<GaslessFeeConfiguration>;
export declare function gasPrices(rawBaseFee: unknown, rawPriority: unknown): {
    readonly baseFeePerGas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
};
