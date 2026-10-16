import { ApnError } from "../errors.js";
/** A configuration failure names the selected network's own setting and its exact cause, never another network's. */
export declare function gaslessConfigError(reason: string, nextAction: string): ApnError;
export declare function validBatchCap(value: number): boolean;
/** The per-chain batch cap setting next to `APN_<NETWORK>_RPC_URL`; absent means the endpoint accepts whole batches. */
export declare function gaslessBatchCapSetting(rpcEnv: string): string;
/** Reads `..._RPC_MAX_BATCH_ITEMS` next to an `..._RPC_URL` setting (2-30); an invalid value is a configuration error. */
export declare function gaslessBatchCap(environment: Readonly<Record<string, string | undefined>>, rpcEnv: string): number | undefined;
