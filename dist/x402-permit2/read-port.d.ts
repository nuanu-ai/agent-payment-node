import { type GaslessTransport } from "../gasless/https.js";
import type { Address } from "../model.js";
import type { Permit2PrepareReadPort } from "./prepare.js";
/** A configured RPC source and the authenticated APN state are required; no signer or sender is accepted. */
export interface Permit2ReadRpcSource {
    /** One read-only request, no retry. Implementations must honor abort before sending and in flight. */
    call(method: "eth_chainId" | "eth_getBlockByNumber" | "eth_call" | "eth_getProof", params: readonly unknown[], signal: AbortSignal): Promise<unknown>;
}
export interface Permit2UsageReader {
    usage(identity: {
        readonly account: string;
        readonly chain: string;
        readonly asset: {
            readonly kind: "token";
            readonly identifier: string;
        };
    }, now: Date): Promise<{
        readonly amountAtomic: string;
    }>;
}
export interface Permit2ProductionReadOptions {
    readonly profile: string;
    readonly stateRoot: string;
    /** Resolve the current local-wallet address from the authenticated wallet binding. */
    readonly localAccount: () => Promise<Address>;
    readonly usage: Permit2UsageReader;
    readonly rpc: Permit2ReadRpcSource;
    readonly transport?: GaslessTransport;
    readonly now?: () => Date;
}
/** Production read adapter for the existing unsigned prepare boundary. It never creates an operation or reservation. */
export declare function createPermit2ProductionReadPort(options: Permit2ProductionReadOptions): Permit2PrepareReadPort;
