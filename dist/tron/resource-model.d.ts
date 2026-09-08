import type { RailPreparedTransfer } from "../direct-rail-ports.js";
import type { TronFeeParameters, TronFinalResources, TronResourceSnapshot } from "./model.js";
export declare function tronBandwidthBytes(rawBytes: bigint): bigint;
export declare function validateTronParameters(value: unknown): TronFeeParameters;
export declare function validateTronResources(value: unknown, prepared: RailPreparedTransfer): TronResourceSnapshot;
export declare function validateTronFinalResources(value: unknown, prepared: RailPreparedTransfer, blockNumber: bigint, success: boolean): TronFinalResources;
