import { ApnError } from "../errors.js";

/** A configuration failure names the selected network's own setting and its exact cause, never another network's. */
export function gaslessConfigError(reason: string, nextAction: string): ApnError {
  return new ApnError("APN_RPC_CONFIG", `Gasless validation failed: ${reason}.`, { nextActions: [nextAction] });
}

export function validBatchCap(value: number): boolean { return Number.isSafeInteger(value) && value >= 2 && value <= 30; }

/** The per-chain batch cap setting next to `APN_<NETWORK>_RPC_URL`; absent means the endpoint accepts whole batches. */
export function gaslessBatchCapSetting(rpcEnv: string): string { return rpcEnv.replace(/_RPC_URL$/u, "_RPC_MAX_BATCH_ITEMS"); }

/** Reads `..._RPC_MAX_BATCH_ITEMS` next to an `..._RPC_URL` setting (2-30); an invalid value is a configuration error. */
export function gaslessBatchCap(environment: Readonly<Record<string, string | undefined>>, rpcEnv: string): number | undefined {
  const setting = gaslessBatchCapSetting(rpcEnv), value = environment[setting];
  if (value === undefined || value === "") return undefined;
  if (!/^(?:[2-9]|[12][0-9]|30)$/u.test(value)) {
    throw gaslessConfigError("gasless_RPC_batch_cap", `Set ${setting} to the largest JSON-RPC batch the endpoint accepts, from 2 through 30, or unset it.`);
  }
  return Number(value);
}
