import type { GaslessTransport } from "../gasless/https.js";
import { StateStore } from "../state.js";
import type { UsdtRecoveryPort } from "./recovery.js";
/** Production read adapter: one bounded pass with persisted provider pacing and fail-closed cooldown. */
export declare function usdtPacedRecoveryPort(state: StateStore, transport: GaslessTransport, rpcUrl: string): UsdtRecoveryPort;
