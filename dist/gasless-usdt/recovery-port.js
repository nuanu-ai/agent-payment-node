import { StateStore } from "../state.js";
import { UsdtCommandReadBudget } from "./command-prepare.js";
import { usdtRecoveryPort } from "./rpc.js";
/** Production read adapter: one bounded pass with persisted provider pacing and fail-closed cooldown. */
export function usdtPacedRecoveryPort(state, transport, rpcUrl) {
    return usdtRecoveryPort(new UsdtCommandReadBudget(state, transport), rpcUrl);
}
//# sourceMappingURL=recovery-port.js.map