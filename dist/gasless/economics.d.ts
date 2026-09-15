import type { GaslessEstimate, GaslessFeeConfiguration, GaslessGas, GaslessIntent, GaslessSnapshot } from "./model.js";
export declare function gaslessGas(snapshot: GaslessSnapshot): GaslessGas;
/** Recognize the two admitted immutable offers without changing saved gas. */
export declare function validateGaslessStoredOffer(gas: GaslessGas, snapshot: GaslessSnapshot): void;
/** v3 intents freeze the owner's whole fee limit; earlier intents froze the exact prepare quote. */
export declare function gaslessFeeCapCovers(intent: Pick<GaslessIntent, "wireVersion" | "feeCapAtomic" | "request">, quoteAtomic: string): boolean;
export declare function gaslessFee(gas: GaslessGas, config: GaslessFeeConfiguration): string;
export declare function validateGaslessGas(value: unknown): GaslessGas;
export declare function assertGaslessEstimate(intent: GaslessIntent, estimate: GaslessEstimate): void;
export declare function assertGaslessSnapshot(intent: GaslessIntent, current: GaslessSnapshot): void;
