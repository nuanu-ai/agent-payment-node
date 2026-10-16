import { HttpsBaseRpc } from "../rpc.js";
import { type Permit2ReadRpcSource, type Permit2UsageReader } from "./read-port.js";
export interface Permit2PreflightRequest {
    readonly profile: string;
    readonly paymentRequired: string;
    readonly expectedChallengeHash: string;
    readonly expectedIndex: string;
    readonly expectedTerms: string;
}
export interface Permit2PreflightPorts {
    readonly rpc: Permit2ReadRpcSource;
    readonly now?: () => Date;
    readonly usage?: Permit2UsageReader;
}
/** An unsigned CLI read with no payment-state persistence; only RPC pacing metadata may be written. */
export declare function permit2CurrentOwnerPreflight(root: string, request: Permit2PreflightRequest, ports: Permit2PreflightPorts): Promise<unknown>;
/**
 * Prepare-time Permit2 reads go through the shared direct-EVM transport: provider-family pacing across processes and a
 * per-command POST cap (EvmDirectRpcGuard), the same mechanism as the signing fence and the observer. One instance per
 * command keeps the DNS pin; each batch races the caller's abort signal.
 */
export declare function permit2PublicRpc(url: string, stateRoot: string, transport?: Pick<HttpsBaseRpc, "batchCall">): Permit2ReadRpcSource;
