import type { ErrorDetail } from "../../errors.js";
import type { MetaMaskGaslessIntent } from "../model.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
/**
 * How the `tx` of a MetaMask job answer compares with the bound request, as closed facts only: no address, number or
 * other provider text leaves. The pinned SDK declares `tx: { from, to, chainId: number, ... }` on every transaction
 * job, but neither the SDK nor `mm` reads `tx` from the relay POST's answer, so APN reports what actually came.
 */
export type JobTxShape = "object" | "absent" | "null" | "other";
/** `owner` is the bound server wallet; any other address (a relayer's, say) is `other_address`. */
export type JobTxFrom = "owner" | "other_address" | "other_string" | "absent" | "other";
export type JobTxChainId = "number" | "decimal_string" | "hex_string" | "caip2_string" | "other_string" | "absent" | "other";
export interface MetaMaskJobTx {
    readonly tx: JobTxShape;
    /** Null unless `tx` is an object. */
    readonly from: JobTxFrom | null;
    readonly chainId: JobTxChainId | null;
    /** Whether a readable chain id names the request's chain; null when there is none. */
    readonly chainIdMatches: boolean | null;
}
export declare function jobTx(value: unknown, intent: Pick<MetaMaskGaslessIntent, "binding" | "request">): MetaMaskJobTx;
export declare function validateJobTx(value: unknown, reason: MetaMaskGaslessFailureReason): MetaMaskJobTx;
/** The facts as flat error details under `prefix` (ErrorDetail values only; a null fact is left out). */
export declare function jobTxDetails(prefix: string, t: MetaMaskJobTx | null): Record<string, ErrorDetail>;
/** The facts back from flat error details, or null when there are none; a malformed set refuses with `reason`. */
export declare function takeJobTx(prefix: string, x: Readonly<Record<string, unknown>>, reason: MetaMaskGaslessFailureReason): MetaMaskJobTx | null;
/** The facts in the output's own key style. */
export declare function jobTxOutput(t: MetaMaskJobTx | null): {
    tx: JobTxShape;
    from: JobTxFrom | null;
    chain_id: JobTxChainId | null;
    chain_id_matches: boolean | null;
} | null;
