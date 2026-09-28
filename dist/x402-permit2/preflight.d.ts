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
/** An unsigned, nonpersistent CLI read. Prepared typed data never crosses this output boundary. */
export declare function permit2CurrentOwnerPreflight(root: string, request: Permit2PreflightRequest, ports: Permit2PreflightPorts): Promise<unknown>;
/** Sequential public HTTPS source, with a per-process gap and no retry or send method. */
export declare function permit2PublicRpc(url: string): Permit2ReadRpcSource;
