import type { GaslessFees, GaslessGas } from "./model.js";
import { gasPrices } from "./rpc-state.js";
/** Quote a new offer from twice the fast priority; an existing offer must still cover slow. */
export declare function bundlerGasPrices(raw: unknown, rawBase: unknown, rawPriority: unknown, approved?: GaslessGas): ReturnType<typeof gasPrices>;
/** Signed fees must still cover the bundler's current slow tier. */
export declare function assertBundlerFeesCover(raw: unknown, signed: GaslessFees): void;
