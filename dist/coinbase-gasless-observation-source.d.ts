import type { CoinbaseGaslessObservationSource, OperationRecord } from "./model.js";
export declare const COINBASE_OBSERVATION_ORIGIN: "https://base-rpc.publicnode.com";
export declare function coinbaseObservationPreset(value: string): "publicnode-base";
export declare function assertCoinbaseObservationRequest(operation: OperationRecord, preset: string, conflict: boolean): void;
export declare function validCoinbaseObservationSource(value: CoinbaseGaslessObservationSource | undefined, origin: string): boolean;
export declare function validCoinbaseSettlementKeys(value: unknown): boolean;
