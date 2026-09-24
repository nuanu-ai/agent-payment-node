import type { GaslessTransport } from "../gasless/https.js";
import { StateStore } from "../state.js";
import { UsdtCommandReadBudget } from "./command-prepare.js";
import type { UsdtRecoveryPort } from "./recovery.js";
import { usdtRecoveryPort } from "./rpc.js";

/** Production read adapter: one bounded pass with persisted provider pacing and fail-closed cooldown. */
export function usdtPacedRecoveryPort(state: StateStore, transport: GaslessTransport, rpcUrl: string): UsdtRecoveryPort {
  return usdtRecoveryPort(new UsdtCommandReadBudget(state, transport), rpcUrl);
}
