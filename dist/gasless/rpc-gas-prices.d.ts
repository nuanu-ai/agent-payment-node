import type { GaslessGas } from "./model.js";
import { gasPrices } from "./rpc-state.js";
/** Quote a new bounded offer from fast; an existing offer must still cover slow. */
export declare function bundlerGasPrices(raw: unknown, rawBase: unknown, rawPriority: unknown, approved?: GaslessGas): ReturnType<typeof gasPrices>;
