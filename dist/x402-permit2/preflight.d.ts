import { ApnError } from "../errors.js";
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
/**
 * A preflight without --rpc-url is refused naming the chain its own expected terms select (any owner-admitted Permit2
 * network, not only Avalanche); terms that name no EVM network are refused as invalid before any RPC is named.
 */
export declare function permit2PreflightRpcRequired(expectedTerms: string): ApnError;
