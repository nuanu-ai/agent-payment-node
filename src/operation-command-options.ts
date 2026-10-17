import { assertCoinbaseObservationRequest } from "./coinbase-gasless-observation-source.js";
import { ApnError } from "./errors.js";
import type { OperationResumeOptions } from "./operation-index/adapter.js";

/**
 * Options of `apn operation resume` belong to the families whose recovery reads them. A family's resume adapter refuses
 * the others with the messages the former generic switch used, in its order: Coinbase observation, observe-only,
 * observation RPC, then the family's own wait refusal.
 */
export interface ResumeOptionUse {
  /** Local, MetaMask and Smart Account gasless recovery may observe through an explicitly named RPC variable. */
  readonly observationRpc?: true;
  /** Absent when the family watches up to --wait-seconds; otherwise its own refusal. */
  readonly refuseWait?: () => never;
}

export function assertResumeOptions(options: OperationResumeOptions, use: ResumeOptionUse): void {
  // Only a saved AWAL gasless direct transfer takes the Coinbase preset; every other record fails that check as before.
  if (options.coinbaseObservationRpc !== undefined) assertCoinbaseObservationRequest({} as never, options.coinbaseObservationRpc, true);
  if (options.observeOnly) refuseObserveOnly();
  if (options.observationRpcEnv !== undefined && use.observationRpc !== true) refuseObservationRpc();
  if (options.waitSeconds !== undefined) use.refuseWait?.();
}

export function refuseObserveOnly(): never {
  throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires a saved local direct transfer.");
}
export function refuseObservationRpc(): never {
  throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery requires a saved Local, MetaMask or Smart Account gasless operation.",
    { reason: "gasless_observation_operation_kind" });
}
/** The refusal of --wait-seconds by a family whose recovery performs one bounded observation. */
export function oneObservationOnly(family: string): never {
  throw new ApnError("APN_INVALID_INPUT", `${family} recovery performs one bounded observation; omit --wait-seconds.`);
}
