import type { Address, Hex } from "../model.js";
import type { MetaMaskGaslessFailure, MetaMaskGaslessReason } from "./reasons.js";
export declare const MM_CHAINS: readonly [1, 10, 56, 137, 143, 1329, 8453, 42161, 59144];
export type MetaMaskGaslessChainId = typeof MM_CHAINS[number];
/** The token scales the lane admits: 6 for the Circle USDC rows, 18 for the Binance-Peg USDT and USDC rows on chain 56. */
export declare const MM_TOKEN_DECIMALS: readonly [6, 18];
export type MetaMaskGaslessDecimals = typeof MM_TOKEN_DECIMALS[number];
/** keccak256 of empty code: the implementation code hash a row pins for a token that is no proxy. */
export declare const MM_EMPTY_CODE_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
export declare const MM_TTL_MS = 300000;
export declare const MM_MIN_REMAINING_MS = 15000;
export declare const MM_OBSERVATION_MAX_AGE_MS = 120000;
export declare const MM_MAX_UINT: bigint;
export declare const MM_PROVIDER_STATUSES: readonly ["awaiting_approval", "pending", "broadcasted", "confirmed", "failed", "denied", "expired", "unavailable"];
/** Final provider job statuses: a later failed read cannot replace them. */
export declare const MM_CLOSED_PROVIDER_STATUSES: readonly ["failed", "denied", "expired"];
export declare const MM_ZERO_ADDRESS: Address;
export declare const MM_ZERO_HASH: string;
export interface MetaMaskGaslessFixedNet {
    readonly netAtomic: string;
    readonly maxGrossAtomic: string;
}
export interface MetaMaskGaslessRequest {
    readonly chainId: MetaMaskGaslessChainId;
    readonly recipient: Address;
    readonly grossAtomic: string;
    readonly maxFeeAtomic: string;
    readonly minReceivedAtomic: string;
    readonly fixedNet?: MetaMaskGaslessFixedNet;
    /**
     * The transfer token, present exactly on a chain whose registry holds several tokens (chain 56: USDT and USDC). A chain
     * with one token row keeps the request without it, as every earlier record does.
     */
    readonly token?: Address;
}
/** Public legacy profile identity. Private provider selection never crosses the helper boundary. */
export interface MetaMaskGaslessProfileIdentity {
    readonly profile: string;
    readonly profileHash: string;
    readonly address: Address;
    readonly accountBindingHash: string;
    readonly capabilityHash: string;
    readonly revision: number;
}
export interface MetaMaskGaslessBinding {
    readonly providerId: "metamask-agent-wallet";
    readonly address: Address;
    readonly accountBindingHash: string;
    readonly capabilityHash: string;
    readonly revision: number;
    readonly projectHash: string;
    readonly walletReferenceHash: string;
    readonly walletIdHash: string;
    readonly namespace: "eip155";
    readonly mode: "server";
    readonly environment: "prod";
}
/** Exact JSON-safe call representation; value is canonical uint256 atoms, never a JS number. */
export interface MetaMaskGaslessExecution {
    readonly target: Address;
    readonly value: string;
    readonly callData: Hex;
}
export type MetaMaskGaslessExecutions = readonly [MetaMaskGaslessExecution] | readonly [MetaMaskGaslessExecution, MetaMaskGaslessExecution];
export interface MetaMaskGaslessQuoteMaterial {
    readonly netAtomic: string;
    readonly feeAtomic: string;
    readonly feeRecipient: Address | null;
    /** Absent on legacy paid quotes; explicit on principal-only sponsored quotes. */
    readonly feeMode?: "sponsored";
    readonly sponsorshipHash?: string;
    readonly executions: MetaMaskGaslessExecutions;
}
export interface MetaMaskGaslessQuote extends MetaMaskGaslessQuoteMaterial {
    readonly hash: string;
}
export interface MetaMaskGaslessCaveat {
    readonly enforcer: Address;
    readonly terms: Hex;
    readonly args: "0x";
}
/** Unsigned canonical context. Empty args are explicit; the public SDK wire adapter may omit them. */
export interface MetaMaskGaslessUnsignedDelegation {
    readonly delegator: Address;
    readonly delegate: Address;
    readonly authority: Hex;
    readonly salt: Hex;
    readonly caveats: readonly [MetaMaskGaslessCaveat, MetaMaskGaslessCaveat];
}
export interface MetaMaskGaslessUnsignedResult {
    readonly unsignedDelegation: MetaMaskGaslessUnsignedDelegation;
    readonly delegationHash: Hex;
    readonly signingDigest: Hex;
    readonly relayTo: Address;
    readonly mode: Hex;
}
export interface MetaMaskGaslessBlock {
    readonly numberAtomic: string;
    readonly hash: Hex;
    readonly timestampAtomic: string;
}
export type MetaMaskGaslessProtocolName = "manager" | "delegate" | "limitedCalls" | "exactBatch";
export type MetaMaskGaslessProtocolPins = Readonly<Record<MetaMaskGaslessProtocolName, {
    readonly address: Address;
    readonly codeHash: Hex;
}>>;
export interface MetaMaskGaslessDeploymentRow {
    readonly chainId: MetaMaskGaslessChainId;
    readonly network: string;
    readonly token: Address;
    readonly decimals: MetaMaskGaslessDecimals;
    readonly finalityTag: "safe" | "finalized";
    readonly protocol: MetaMaskGaslessProtocolPins;
    /** The token contract's own runtime code hash (the proxy's, for a proxied token). */
    readonly tokenProxyCodeHash: Hex;
    readonly tokenImplementationSlot: Hex;
    /**
     * The implementation the slot names. A token that is no proxy pins the zero address with `MM_EMPTY_CODE_HASH`: its slot
     * must read zero and its own pinned runtime is all the code it runs.
     */
    readonly tokenImplementationAddress: Address;
    readonly tokenImplementationCodeHash: Hex;
    readonly evidenceBlock: MetaMaskGaslessBlock;
    readonly provenance: Readonly<Record<"runtime" | "token" | "raw", {
        readonly path: string;
        readonly rowIndex: number;
    }>>;
}
export interface MetaMaskGaslessDeployment {
    readonly row: MetaMaskGaslessDeploymentRow;
    readonly deploymentEvidenceHash: string;
}
export interface MetaMaskGaslessChainState {
    readonly protocolCodeHashes: Readonly<Record<MetaMaskGaslessProtocolName, Hex> | Record<"manager" | "delegate" | "limitedCalls" | "exactSingle", Hex>>;
    readonly tokenProxyCodeHash: Hex;
    readonly tokenImplementationAddress: Address;
    readonly tokenImplementationCodeHash: Hex;
    readonly tokenDecimals: MetaMaskGaslessDecimals;
    readonly ownerCodeHash: Hex;
    readonly designation: "empty" | "pinned";
    /** The owner's balance of the transfer token, in its atoms; the name predates tokens other than USDC. */
    readonly usdcBalanceAtomic: string;
    readonly counterAtomic: string;
}
export interface MetaMaskGaslessSnapshot {
    readonly chainId: MetaMaskGaslessChainId;
    readonly endpointHash: string;
    readonly endpointOrigin: string;
    readonly observedAt: string;
    readonly safeBlock: MetaMaskGaslessBlock;
    readonly headBlock: MetaMaskGaslessBlock;
    readonly safeState: MetaMaskGaslessChainState;
    readonly headState: MetaMaskGaslessChainState;
}
export interface MetaMaskGaslessBalance {
    readonly chainId: MetaMaskGaslessChainId;
    readonly endpointHash: string;
    readonly endpointOrigin: string;
    readonly observedAt: string;
    readonly block: MetaMaskGaslessBlock;
    readonly state: Omit<MetaMaskGaslessChainState, "counterAtomic">;
}
export interface MetaMaskGaslessIntent extends MetaMaskGaslessUnsignedResult {
    readonly profile: string;
    readonly request: MetaMaskGaslessRequest;
    readonly binding: MetaMaskGaslessBinding;
    readonly token: Address;
    readonly decimals: MetaMaskGaslessDecimals;
    readonly deploymentEvidenceHash: string;
    readonly initialSnapshot: MetaMaskGaslessSnapshot;
    readonly preparedGrossAtomic?: string;
    readonly quote: MetaMaskGaslessQuote;
    /**
     * The request id APN chose at prepare: MetaMask's id for this relay job, the one the owner's MFA approval waits on.
     * A record that an earlier release wrote keeps the id itself here. A newer record keeps only `requestIdHash` and seals
     * the id under the Keychain wrapping secret (journal/request-reference.ts). A saved intent holds exactly one of the two.
     */
    readonly requestId?: string;
    readonly requestIdHash?: string;
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly policyHash: string;
}
/** What the provider helper is handed: the intent with the request id itself, never its hash (client/protocol.ts). */
export type MetaMaskGaslessProviderIntent = Omit<MetaMaskGaslessIntent, "requestId" | "requestIdHash"> & {
    readonly requestId: string;
};
/**
 * The exact batch and delegation actually dispatched, when the provider's price at the guard differed from the
 * prepared one. Written once, in the same durable transition as the dispatch marker, and never afterwards.
 */
export interface MetaMaskGaslessDispatch extends MetaMaskGaslessUnsignedResult {
    readonly quote: MetaMaskGaslessQuote;
}
export interface MetaMaskGaslessApproval {
    readonly fingerprint: string;
    readonly approvedAt: string;
    readonly expiresAt: string;
}
export interface MetaMaskGaslessProviderObservation {
    readonly observedAt: string;
    readonly requestIdHash: string;
    /**
     * MetaMask's closed job statuses stay distinct where they mean different things: `denied` and `expired` are the
     * provider's DENIED and EXPIRED, `failed` is FAILED or BROADCAST_FAILED. None of them proves that no signature exists.
     */
    readonly status: "awaiting_approval" | "pending" | "broadcasted" | "confirmed" | "failed" | "denied" | "expired" | "unavailable";
    readonly txHash: Hex | null;
}
export interface MetaMaskGaslessCursor {
    readonly startBlock: MetaMaskGaslessBlock;
    readonly nextBlockAtomic: string;
    readonly previousEndBlock: MetaMaskGaslessBlock | null;
}
export interface MetaMaskGaslessObservation {
    readonly observedAt: string;
    /** `disabled`: at `finalityBlock` the count is 0 and the manager refuses the delegation (proof of no effect). */
    readonly phase: "pending" | "unavailable" | "invalid" | "reorg" | "reverted" | "success" | "disabled";
    readonly reason: MetaMaskGaslessReason;
    readonly candidateTxHash: Hex | null;
    readonly transactionBlock: MetaMaskGaslessBlock | null;
    readonly finalityBlock: MetaMaskGaslessBlock | null;
    readonly evidenceHash: string | null;
    readonly source?: MetaMaskGaslessObservationSource;
}
/** Redacted identity of an owner-named observation RPC; the URL itself is never stored. */
export interface MetaMaskGaslessObservationSource {
    readonly environmentName: string;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
}
export interface MetaMaskGaslessSettlement {
    readonly observedAt: string;
    readonly txHash: Hex;
    readonly transactionBlock: MetaMaskGaslessBlock;
    readonly finalityBlock: MetaMaskGaslessBlock;
    readonly outerSender: Address;
    readonly transactionProofHash: string;
    readonly receiptHash: string;
    readonly protocolHash: string;
    readonly tokenImplementationHash: string;
    readonly deliveredAtomic: string;
    readonly feeAtomic: string;
    readonly debitAtomic: string;
    readonly refundAtomic: "0";
    readonly unusedGrossAtomic: string;
    readonly designation: "pinned";
    readonly permission: "consumed";
    readonly receiptCounterAtomic: "1";
    readonly finalityCounterAtomic: "1";
}
export interface MetaMaskGaslessRpcObservation {
    readonly cursor: MetaMaskGaslessCursor;
    readonly observation: MetaMaskGaslessObservation;
    readonly settlement: MetaMaskGaslessSettlement | null;
}
export type MetaMaskGaslessState = "awaiting_approval" | "execution_pending" | "dispatch_pending" | "submitted_pending" | "unknown_finality" | "failed_effects_pending" | "completed" | "failed_before_effect" | "abandoned_unknown" | 
/** Dispatched, never redeemed, and disabled on chain by its own delegator: proved to have no effect. */
"revoked_unused";
export interface MetaMaskGaslessMutable {
    readonly state: MetaMaskGaslessState;
    readonly approval: MetaMaskGaslessApproval | null;
    readonly submissionAttempts: 0 | 1;
    readonly dispatchStartedAt: string | null;
    /** Absent in records written before the reprice guard existed; those carry the prepared material only. */
    readonly dispatch?: MetaMaskGaslessDispatch | null | undefined;
    readonly providerObservation: MetaMaskGaslessProviderObservation | null;
    readonly cursor: MetaMaskGaslessCursor;
    readonly observation: MetaMaskGaslessObservation | null;
    readonly settlement: MetaMaskGaslessSettlement | null;
    readonly failure: MetaMaskGaslessFailure | null;
}
