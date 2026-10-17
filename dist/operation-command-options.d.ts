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
export declare function assertResumeOptions(options: OperationResumeOptions, use: ResumeOptionUse): void;
export declare function refuseObserveOnly(): never;
export declare function refuseObservationRpc(): never;
/** The refusal of --wait-seconds by a family whose recovery performs one bounded observation. */
export declare function oneObservationOnly(family: string): never;
