import type { Address, Hex } from "../model.js";
import { type GaslessTransport } from "./https.js";
import type { GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessEstimate, GaslessFees, GaslessGas, GaslessIntent, GaslessObservation, GaslessSnapshot } from "./model.js";
import type { GaslessBootstrapMaterial, GaslessRpcFactory, GaslessRpcPort, GaslessUserOperationMaterial } from "./ports.js";
/** One command invocation includes RPC and bundler POSTs, including failed transport attempts. */
export declare class GaslessRpcRequestSession {
    private posts;
    private terminalStatus;
    private readonly verifiedChains;
    private readonly protocolAnchors;
    readonly maxBatchItems: number;
    constructor(maxBatchItems?: number);
    reserve(): void;
    assertActive(): void;
    rejectHttp(status: number): never;
    hasVerifiedChain(rpc: GaslessRpc): boolean;
    verifyChain(rpc: GaslessRpc): void;
    protocolAt(rpc: GaslessRpc, hash: Hex, verify: () => Promise<void>): Promise<void>;
}
/** Wrap a public APN command so a reused RPC factory receives a fresh 24-POST budget. */
export declare function withGaslessRpcInvocation<T>(work: () => Promise<T>, maxBatchItems?: number): Promise<T>;
/** Reuse the public command's budget, or start one for a directly invoked observation port. */
export declare function withinGaslessRpcInvocation<T>(work: () => Promise<T>): Promise<T>;
export declare function gaslessRpcInvocation(): GaslessRpcRequestSession;
export declare function gaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessRpcFactory;
export declare class GaslessRpc implements GaslessRpcPort {
    private readonly transport;
    private readonly fallbackSession;
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    readonly bundlerOrigin: string;
    readonly bundlerEndpointHash: string;
    private readonly rpcEndpoint;
    private readonly bundlerEndpoint;
    private readonly deployment;
    private sequence;
    private readonly rpcCall;
    private readonly bundlerCall;
    private readonly pendingReads;
    constructor(chainId: GaslessChainId, rpcUrl: string, bundlerUrl?: string, transport?: GaslessTransport, fallbackSession?: GaslessRpcRequestSession);
    assertChain(): Promise<void>;
    private validateChain;
    snapshot(owner: Address, approvedGas?: GaslessGas): Promise<GaslessSnapshot>;
    /** One bounded, read-only HTTP batch; no effect call can enter this batch. */
    private bundlerState;
    mirrorEstimate(intent: GaslessIntent, fees?: GaslessFees): Promise<GaslessEstimate>;
    estimate(intent: GaslessIntent, bootstrap: GaslessBootstrapMaterial, fees?: GaslessFees): Promise<GaslessEstimate>;
    send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial): Promise<Hex>;
    observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
    private assertChainUnlessVerified;
    /** Returns the admitted asset the intent names, so no caller has to re-derive it from a literal. */
    private assertIntent;
    /**
     * The row's `balanceLayout` is a claim about one token implementation's storage, never protocol knowledge, so it is
     * proved twice before it is trusted. First the claim must name the implementation this chain is verified to run, so
     * a layout description can never outlive the code it describes. Then it is measured: the owner's balance word at the
     * claimed slot must equal the balance the frozen snapshot already read through `balanceOf` at that exact block.
     * A row with no claim, a claim for another implementation, a zero witness balance or any disagreement fails closed
     * rather than fabricating a balance at an unverified slot.
     */
    private provenBalanceSlot;
    private call;
    /** Same-turn read calls share one physical POST; invocation sessions never share a batch. */
    private queueRead;
    private flushReads;
}
/** Storage key of a Solidity `mapping(address => uint256)` entry at the given base slot. */
export declare function gaslessBalanceSlot(holder: Address, base: string): Hex;
