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
/** Read plans of the live rails in calls per client (P4): chain identity; functional configuration with its head;
 * the attester set (head, threshold, count, at most 20 attesters); one account; one envelope (head, tip, estimate);
 * one effect preflight (two nonces, balance, allowance, estimate, simulation, mint head and used nonce); one
 * observation (transaction, receipt, finality head, canonical block). */
export declare const CIRCLE_READ_PLAN: {
    readonly identity: 1;
    readonly configuration: 13;
    readonly attesters: 23;
    readonly account: 5;
    readonly envelope: 3;
    readonly preflight: 8;
    readonly observation: 4;
    readonly single: 1;
    readonly ambiguous: 4;
};
/** The longest live command: identity, configuration, attesters, two accounts, two envelopes, three effect preflights,
 * eight observations, one ambiguous-send check (two nonces, transaction, receipt) and four single reads (allowance,
 * used nonce, cleanup nonce, mint head), each retried once. */
export declare const CIRCLE_COMMAND_REQUEST_BUDGET: number;
/** Public HTTPS/DNS pinning and physical request accounting. Only transient read-only HTTP failures
 * retry once; an observation restarts wholly. Financial RPC is never retried. The chain id is checked once per client,
 * reads issued together leave as one JSON-RPC batch POST (every default Circle endpoint accepts batches), and an
 * observation needs no header sandwich. */
export declare class CircleRpc {
    readonly chainId: number;
    private readonly https;
    private readonly maxRequests;
    private sequence;
    private requests;
    private posts;
    private readonly endpoint;
    private chainVerified;
    private queued;
    private readonly scopes;
    constructor(url: string, chainId: number, https?: Pick<BridgeHttps, "request">, maxRequests?: number);
    /** Read calls counted against the budget, and physical POSTs sent (a batch is one POST). */
    get requestCount(): number;
    get postCount(): number;
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
    private physicalCall;
    /** Reads queued in the same tick leave as one POST; a lone read keeps the plain single-call wire shape. */
    private flush;
    private post;
    private envelopeRecord;
    private result;
    identity(): Promise<void>;
    read(to: Address, name: string, args?: readonly unknown[], tag?: string | {
        readonly blockHash: Hex;
        readonly requireCanonical: true;
    }): Promise<unknown>;
    block(tag: string): Promise<Record<string, unknown>>;
    observation(transactionHash: Hex, finalityTag: "included" | "safe" | "finalized"): Promise<CircleObservation | null>;
    /** Two POSTs: transaction and receipt, then the finality head with the canonical block at the receipt height. A head
     * at or above that height read with the canonical block makes a separate header recheck redundant (P2). */
    private leanObservation;
    account(address: Address, token: Address, spender: Address): Promise<CircleAccountPreflight>;
    envelope(from: Address, to: Address, data: Hex, nonceAtomic: string, gasLimit?: string): Promise<CircleEnvelope>;
}
/** The live rails read functional configuration only, at the latest head, as one batch: domains, remote messenger,
 * local minter/transmitter, token pair, versions, decimals and paused flags (P1/P5). Implementation addresses and
 * code hashes change on legitimate Circle upgrades and are not read. */
export declare function readCircleDeployment(rpc: CircleRpc, destinationChain: CircleDestinationChain): Promise<CircleDeploymentSnapshot>;
export declare function currentCircleDeployments(source: CircleRpc, destination: CircleRpc, chain: CircleDestinationChain): Promise<{
    source: CircleDeploymentSnapshot;
    destination: CircleDeploymentSnapshot;
    digest: string;
}>;
/** The live rails read the attester set at the latest head: threshold and count in one batch, then every enabled
 * attester in a second. Signatures are recovered against this set; no block sandwich is needed for a current read. */
export declare function readCircleAttesters(rpc: CircleRpc, deploymentDigest: string): Promise<CircleAttesterSnapshot>;
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
