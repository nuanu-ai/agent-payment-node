import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";
import { BridgeHttps } from "./https.js";
import type { BridgeRpcFactory } from "./ports.js";
import { type RpcBatchReadItem, RpcReadSession } from "./rpc-session.js";
export declare const BRIDGE_RPC_ENV: {
    readonly 1: "APN_ETHEREUM_RPC_URL";
    readonly 56: "APN_BNB_RPC_URL";
    readonly 8453: "APN_BASE_RPC_URL";
    readonly 143: "APN_MONAD_RPC_URL";
    readonly 42161: "APN_ARBITRUM_RPC_URL";
    readonly 59144: "APN_LINEA_RPC_URL";
};
export interface BridgeRpcRequestTrace {
    readonly origin: string;
    readonly endpointRole: "primary" | "receipt" | "archive";
    readonly methods: readonly string[];
    readonly batchSize: number;
}
export declare function bridgeRpcCall(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>, options?: {
    readonly transport?: Pick<BridgeHttps, "request">;
    readonly wait?: (milliseconds: number) => Promise<void>;
    /** Optional read-only observation hook; called from the selected production route before each physical HTTP attempt. */
    readonly onRequest?: (trace: BridgeRpcRequestTrace) => void;
}): {
    readonly origin: string;
    readonly call: EvmRpcCall;
    readonly attempt: EvmRpcCall;
    readonly sessionCall: (session: RpcReadSession) => EvmRpcCall;
    readonly sessionBatchCall: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]>;
};
export declare function bridgeRpcFactory(environment: Readonly<Record<string, string | undefined>>, options?: {
    readonly transport?: Pick<BridgeHttps, "request">;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly onRequest?: (trace: BridgeRpcRequestTrace) => void;
}): BridgeRpcFactory;
