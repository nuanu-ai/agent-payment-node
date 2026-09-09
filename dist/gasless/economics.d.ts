import type { GaslessEstimate, GaslessFeeConfiguration, GaslessGas, GaslessIntent, GaslessSnapshot } from "./model.js";
export declare function gaslessGas(snapshot: GaslessSnapshot): GaslessGas;
export declare function gaslessFee(gas: GaslessGas, config: GaslessFeeConfiguration): string;
export declare function validateGaslessGas(value: unknown): GaslessGas;
export declare function assertGaslessEstimate(intent: GaslessIntent, estimate: GaslessEstimate): void;
export declare function assertGaslessSnapshot(intent: GaslessIntent, current: GaslessSnapshot): void;
