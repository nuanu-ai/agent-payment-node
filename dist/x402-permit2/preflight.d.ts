import { HttpsBaseRpc } from "../rpc.js";
import { type Permit2ReadRpcSource, type Permit2UsageReader } from "./read-port.js";
import type { GaslessTransport } from "../gasless/https.js";
export interface Permit2PreflightRequest {
    readonly profile: string;
    readonly paymentRequired: string;
    readonly expectedChallengeHash: string;
    readonly expectedIndex: string;
    readonly expectedTerms: string;
}
export interface Permit2PreflightPorts {
    readonly rpc: Permit2ReadRpcSource;
    readonly transport?: GaslessTransport;
    readonly now?: () => Date;
    readonly usage?: Permit2UsageReader;
}
/** An unsigned CLI read with no payment-state persistence; only RPC pacing metadata may be written. */
export declare function permit2CurrentOwnerPreflight(root: string, request: Permit2PreflightRequest, ports: Permit2PreflightPorts): Promise<unknown>;
/** Cross-process pacing uses APN's kernel-backed state lock and operational RPC pacing record. */
export declare function permit2PublicRpc(url: string, stateRoot: string, transport?: Pick<HttpsBaseRpc, "permit2ReadCall">): Permit2ReadRpcSource;
