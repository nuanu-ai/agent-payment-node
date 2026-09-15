import type { GaslessEstimate, GaslessFeeConfiguration, GaslessFees, GaslessGas, GaslessIntent, GaslessSnapshot } from "./model.js";
export declare function gaslessGas(snapshot: GaslessSnapshot): GaslessGas;
/** The v4 offer: calibrated limits on Ethereum and Polygon, the v3 sizes on every other chain. */
export declare function gaslessCalibratedGas(snapshot: GaslessSnapshot): GaslessGas;
/** Recognize each admitted immutable offer for its wire version without changing saved gas. */
export declare function validateGaslessStoredOffer(gas: GaslessGas, snapshot: GaslessSnapshot, wireVersion: GaslessIntent["wireVersion"]): void;
/** v3 and v4 intents freeze the owner's whole fee limit; earlier intents froze the exact prepare quote. */
export declare function gaslessFeeCapCovers(intent: Pick<GaslessIntent, "wireVersion" | "feeCapAtomic" | "request">, quoteAtomic: string): boolean;
export declare function gaslessFee(gas: GaslessGas, config: GaslessFeeConfiguration): string;
export declare function validateGaslessGas(value: unknown): GaslessGas;
export declare function assertGaslessEstimate(intent: GaslessIntent, estimate: GaslessEstimate): void;
/** `fees` are the prices the next step uses: v4 chooses them after approval, earlier intents keep their frozen gas. */
export declare function assertGaslessSnapshot(intent: GaslessIntent, current: GaslessSnapshot, fees?: GaslessFees): void;
