import { assertCoinbaseObservationRequest } from "./coinbase-gasless-observation-source.js";
import { ApnError } from "./errors.js";
export function assertResumeOptions(options, use) {
    // Only a saved AWAL gasless direct transfer takes the Coinbase preset; every other record fails that check as before.
    if (options.coinbaseObservationRpc !== undefined)
        assertCoinbaseObservationRequest({}, options.coinbaseObservationRpc, true);
    if (options.observeOnly)
        refuseObserveOnly();
    if (options.observationRpcEnv !== undefined && use.observationRpc !== true)
        refuseObservationRpc();
    if (options.waitSeconds !== undefined)
        use.refuseWait?.();
}
export function refuseObserveOnly() {
    throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires a saved local direct transfer.");
}
export function refuseObservationRpc() {
    throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery requires a saved Local, MetaMask or Smart Account gasless operation.", { reason: "gasless_observation_operation_kind" });
}
/** The refusal of --wait-seconds by a family whose recovery performs one bounded observation. */
export function oneObservationOnly(family) {
    throw new ApnError("APN_INVALID_INPUT", `${family} recovery performs one bounded observation; omit --wait-seconds.`);
}
//# sourceMappingURL=operation-command-options.js.map