import type { TronFeeParameters, TronResourceSnapshot } from "./model.js";
import { type TronBlock, type TronRpcPort } from "./rpc.js";
export interface TronWindow {
    readonly header: TronBlock;
    readonly parameters: TronFeeParameters;
    readonly nextMaintenance: bigint;
    readonly expiration: bigint;
}
/**
 * One read of the window: maintenance time, then chain parameters, then the head. A head still before that maintenance
 * proves no maintenance ran between the reads, so the parameters belong to the period the transaction expires in.
 */
export declare function readTronWindow(rpc: TronRpcPort, now: () => Date): Promise<TronWindow>;
/**
 * Chain parameters change only at a maintenance boundary, and the frozen window expires before the next one, so a head
 * still inside the window proves they are unchanged without reading them again. The reference block is re-read because
 * the signed transaction names it; the solidified recipient head the snapshot recorded is irreversible and is not.
 */
export declare function revalidateTronWindow(rpc: TronRpcPort, snapshot: TronResourceSnapshot, now: () => Date): Promise<void>;
