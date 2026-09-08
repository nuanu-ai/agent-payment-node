import type { TronFeeParameters, TronResourceSnapshot } from "./model.js";
import { type TronBlock, type TronRpcPort } from "./rpc.js";
export interface TronWindow {
    readonly header: TronBlock;
    readonly parameters: TronFeeParameters;
    readonly nextMaintenance: bigint;
    readonly expiration: bigint;
}
export declare function readTronWindow(rpc: TronRpcPort, now: () => Date): Promise<TronWindow>;
export declare function revalidateTronWindow(rpc: TronRpcPort, snapshot: TronResourceSnapshot, now: () => Date): Promise<void>;
