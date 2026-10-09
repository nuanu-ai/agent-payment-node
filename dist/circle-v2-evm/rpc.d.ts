import { type Address, type Hex } from "viem";
import { BridgeHttps } from "../lifi/https.js";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleAttesterSnapshot, type CircleObservation } from "./protocol.js";
import { type CircleDeploymentSnapshot, type CircleAccountPreflight } from "./preflight.js";
import { type CircleEnvelope } from "./operation-model.js";
export declare const CIRCLE_RPC_ABI: readonly [{
    readonly name: "localDomain";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly name: "version";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "remoteTokenMessengers";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint32";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
}, {
    readonly name: "localMinter";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "localMessageTransmitter";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "messageBodyVersion";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly name: "localTokenMessenger";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "remoteTokensToLocalTokens";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }, {
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "usedNonces";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "signatureThreshold";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "getNumEnabledAttesters";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "getEnabledAttester";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}];
/** Public HTTPS/DNS pinning and physical request accounting. Only transient read-only HTTP failures
 * retry once; anchored observations restart wholly. Financial RPC is never retried. */
export declare class CircleRpc {
    readonly chainId: number;
    private readonly https;
    private readonly maxRequests;
    private sequence;
    private requests;
    private readonly endpoint;
    private readonly scopes;
    constructor(url: string, chainId: number, https?: Pick<BridgeHttps, "request">, maxRequests?: number);
    guarded<T>(guard: () => void, action: () => Promise<T>): Promise<T>;
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
    private physicalCall;
    identity(): Promise<void>;
    read(to: Address, name: string, args?: readonly unknown[], tag?: string | {
        readonly blockHash: Hex;
        readonly requireCanonical: true;
    }): Promise<unknown>;
    block(tag: string): Promise<Record<string, unknown>>;
    observation(transactionHash: Hex, finalityTag: "included" | "safe" | "finalized"): Promise<CircleObservation | null>;
    private anchoredObservation;
    account(address: Address, token: Address, spender: Address): Promise<CircleAccountPreflight>;
    envelope(from: Address, to: Address, data: Hex, nonceAtomic: string, gasLimit?: string): Promise<CircleEnvelope>;
}
export declare function readCircleDeployment(rpc: CircleRpc, destinationChain: CircleDestinationChain, historicalBlock?: Record<string, unknown>): Promise<CircleDeploymentSnapshot>;
export declare function currentCircleDeployments(source: CircleRpc, destination: CircleRpc, chain: CircleDestinationChain): Promise<{
    source: CircleDeploymentSnapshot;
    destination: CircleDeploymentSnapshot;
    digest: string;
}>;
export declare function readCircleAttesters(rpc: CircleRpc, deploymentDigest: string, historicalBlock?: Record<string, unknown>): Promise<CircleAttesterSnapshot>;
export declare const circleRpcTransaction: (e: CircleEnvelope) => {
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    nonce: string;
    gas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
};
/** EIP-170 runtime code is a distinct field domain from CCTP messages and sealed transactions. */
export declare function circleRuntimeBytecode(value: unknown): Hex;
