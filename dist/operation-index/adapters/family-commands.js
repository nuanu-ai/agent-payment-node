import { ApnError } from "../../errors.js";
/**
 * The generic `apn operation status|resume|abandon` answers of the families phase 4b WP2 added. Each delegates to the
 * family's own command code (loaded when called, so the adapters add nothing to the module graph the index loads).
 */
export const OPERATION_STATUS = "apn operation status --operation <operation-id>";
export const OPERATION_RESUME = "apn operation resume --operation <operation-id>";
export const OPERATION_ABANDON = "apn operation abandon --operation <operation-id>";
/**
 * A family whose recovery reads none of the `operation resume` options refuses each one with the message the generic
 * command used (phase 4b WP3 keeps the shared helper; this is its no-option case).
 */
export function assertNoResumeOptions(options, family) {
    if (options.coinbaseObservationRpc !== undefined) {
        throw new ApnError("APN_INVALID_INPUT", "Coinbase observation recovery requires a saved AWAL gasless direct transfer.");
    }
    if (options.observeOnly)
        throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires a saved local direct transfer.");
    if (options.observationRpcEnv !== undefined) {
        throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery requires a saved Local, MetaMask or Smart Account gasless operation.", { reason: "gasless_observation_operation_kind" });
    }
    if (options.waitSeconds !== undefined)
        throw new ApnError("APN_INVALID_INPUT", `${family} recovery performs one bounded observation; omit --wait-seconds.`);
}
/** The family runtime a command needs, or the same refusal its own command gives when it is not installed. */
export function installed(service, message) {
    if (service === undefined)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", message);
    return service;
}
//# sourceMappingURL=family-commands.js.map