import type { Address, Hex } from "../model.js";
import type { MetaMaskGaslessFailure, MetaMaskGaslessReason } from "./reasons.js";

export const MM_CHAINS = [1, 10, 137, 143, 1329, 8453, 42161, 59144] as const;
export type MetaMaskGaslessChainId = typeof MM_CHAINS[number];
export const MM_TTL_MS = 300_000;
export const MM_MIN_REMAINING_MS = 15_000;
export const MM_OBSERVATION_MAX_AGE_MS = 120_000;
export const MM_MAX_UINT = (1n << 256n) - 1n;
export const MM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const MM_ZERO_HASH = "0".repeat(64);

export interface MetaMaskGaslessRequest {
  readonly chainId: MetaMaskGaslessChainId;
  readonly recipient: Address;
  readonly grossAtomic: string;
  readonly maxFeeAtomic: string;
  readonly minReceivedAtomic: string;
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
export type MetaMaskGaslessExecutions = readonly [MetaMaskGaslessExecution, MetaMaskGaslessExecution];
export interface MetaMaskGaslessQuoteMaterial {
  readonly netAtomic: string;
  readonly feeAtomic: string;
  readonly feeRecipient: Address;
  readonly executions: MetaMaskGaslessExecutions;
}
export interface MetaMaskGaslessQuote extends MetaMaskGaslessQuoteMaterial { readonly hash: string }
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
export type MetaMaskGaslessProtocolPins = Readonly<Record<MetaMaskGaslessProtocolName,
  { readonly address: Address; readonly codeHash: Hex }>>;
export interface MetaMaskGaslessDeploymentRow {
  readonly chainId: MetaMaskGaslessChainId;
  readonly network: string;
  readonly token: Address;
  readonly decimals: 6;
  readonly finalityTag: "safe" | "finalized";
  readonly protocol: MetaMaskGaslessProtocolPins;
  readonly tokenProxyCodeHash: Hex;
  readonly tokenImplementationSlot: Hex;
  readonly tokenImplementationAddress: Address;
  readonly tokenImplementationCodeHash: Hex;
  readonly evidenceBlock: MetaMaskGaslessBlock;
  readonly provenance: Readonly<Record<"runtime" | "token" | "raw", { readonly path: string; readonly rowIndex: number }>>;
}
export interface MetaMaskGaslessDeployment {
  readonly row: MetaMaskGaslessDeploymentRow;
  readonly deploymentEvidenceHash: string;
}
export interface MetaMaskGaslessChainState {
  readonly protocolCodeHashes: Readonly<Record<MetaMaskGaslessProtocolName, Hex>>;
  readonly tokenProxyCodeHash: Hex;
  readonly tokenImplementationAddress: Address;
  readonly tokenImplementationCodeHash: Hex;
  readonly tokenDecimals: 6;
  readonly ownerCodeHash: Hex;
  readonly designation: "empty" | "pinned";
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
  readonly decimals: 6;
  readonly deploymentEvidenceHash: string;
  readonly initialSnapshot: MetaMaskGaslessSnapshot;
  readonly quote: MetaMaskGaslessQuote;
  readonly requestId: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly policyHash: string;
}
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
  readonly status: "awaiting_approval" | "pending" | "broadcasted" | "confirmed" | "failed" | "unavailable";
  readonly txHash: Hex | null;
}
export interface MetaMaskGaslessCursor {
  readonly startBlock: MetaMaskGaslessBlock;
  readonly nextBlockAtomic: string;
  readonly previousEndBlock: MetaMaskGaslessBlock | null;
}
export interface MetaMaskGaslessObservation {
  readonly observedAt: string;
  readonly phase: "pending" | "unavailable" | "invalid" | "reorg" | "reverted" | "success";
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
  readonly unusedGrossAtomic: "0";
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
export type MetaMaskGaslessState = "awaiting_approval" | "execution_pending" | "dispatch_pending" |
  "submitted_pending" | "unknown_finality" | "failed_effects_pending" | "completed" | "failed_before_effect" | "abandoned_unknown";
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
