/** Offline correlation of frozen provider responses with independently parsed chain candidates.
 * The caller is responsible for acquiring and authenticating each response.
 * This module never admits execution or declares bridge settlement.
 * Schema references: docs.li.fi/agents/reference/endpoint-specs GET /status and
 * docs.near-intents.org/api-reference/oneclick/check-swap-execution-status.
 */
import type { NearTronSourceDepositCandidate } from "./near-tron-source-receipt.js";
import type { TronDestinationCandidate } from "./tron-destination-candidate.js";
import { bridgeFailure } from "./validation.js";

// Pinned to the official 1Click supported-assets listing for this one route.
// Unknown or changed asset IDs require a new review before offline correlation.
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NEAR_BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const NEAR_TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";

export interface NearTronProviderCorrelation {
  readonly kind: "offline_near_tron_provider_correlation";
  readonly executionAdmitted: false;
  readonly bridgeCompletion: false;
  readonly providerOutcome: "correlated_success";
  readonly sourceTransactionHash: string;
  readonly destinationTransactionId: string;
  readonly transactionId: string;
  readonly recipient: string;
  readonly receivedAtomic: string;
}
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `near_tron_provider_${reason}`); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("shape");
  return value as Record<string, unknown>;
}
function eq(a: unknown, b: unknown): boolean { return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase(); }
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0x)?[a-fA-F0-9]{64}$/u.test(value)) fail("hash");
  return value.toLowerCase().replace(/^0x/u, "");
}
function oneHash(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) fail("ambiguous_hashes");
  return hash(record(value[0]).hash);
}
function positive(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) fail("amount");
  return BigInt(value);
}
export function correlateNearTronProviderStatusOffline(
  source: NearTronSourceDepositCandidate, lifiRaw: unknown, nearRaw: unknown,
  destinationCandidates: readonly TronDestinationCandidate[],
): NearTronProviderCorrelation {
  if (source.kind !== "offline_near_tron_source_deposit_candidate" || source.executionAdmitted !== false || source.bridgeCompletion !== false ||
    source.status !== "unverified" || source.recipientDelivery !== "unverified" || source.chainId !== 8453 ||
    !eq(source.sourceToken, BASE_USDC)) fail("source_candidate");
  const lifi = record(lifiRaw), near = record(nearRaw);
  const sending = record(lifi.sending), receiving = record(lifi.receiving);
  if (lifi.status !== "DONE" || lifi.substatus !== "COMPLETED" ||
    !eq(lifi.transactionId, source.transactionId) || !eq(sending.txHash, source.transactionHash) ||
    sending.chainId !== 8453 || receiving.chainId !== 728126428 || lifi.tool !== "near" ||
    !eq(record(sending.token).address, source.sourceToken) ||
    record(receiving.token).address !== source.quotedDestinationToken ||
    positive(receiving.amount) < positive(source.minimumOutputAtomic)) fail("lifi_binding");
  const destinationHash = hash(receiving.txHash);
  const quoteResponse = record(near.quoteResponse), quoteRequest = record(quoteResponse.quoteRequest), quote = record(quoteResponse.quote);
  const details = record(near.swapDetails);
  if (near.status !== "SUCCESS" || !eq(quote.depositAddress, source.depositAddress) ||
    quoteRequest.originAsset !== NEAR_BASE_USDC || quoteRequest.destinationAsset !== NEAR_TRON_USDT ||
    quoteRequest.swapType !== "EXACT_INPUT" || quoteRequest.depositType !== "ORIGIN_CHAIN" ||
    quoteRequest.recipientType !== "DESTINATION_CHAIN" || quoteRequest.refundType !== "ORIGIN_CHAIN" ||
    positive(quoteRequest.amount) !== positive(source.bridgeAmountAtomic) ||
    quote.depositMemo !== undefined && quote.depositMemo !== null && quote.depositMemo !== "" ||
    quoteRequest.recipient !== source.tronRecipient || !eq(quoteRequest.refundTo, source.refundTo) ||
    positive(quote.minAmountOut) !== positive(source.minimumOutputAtomic) ||
    positive(quote.amountIn) !== positive(source.bridgeAmountAtomic) ||
    oneHash(details.originChainTxHashes) !== hash(source.transactionHash) ||
    oneHash(details.destinationChainTxHashes) !== destinationHash ||
    positive(details.amountIn) !== positive(source.bridgeAmountAtomic) ||
    positive(details.amountOut) !== positive(receiving.amount) ||
    details.refundReason !== undefined && details.refundReason !== null && details.refundReason !== "" ||
    details.refundedAmount !== undefined && details.refundedAmount !== "0") fail("near_binding");
  if (!Array.isArray(destinationCandidates)) fail("destination_ambiguity");
  const matching = destinationCandidates.filter(item => hash(item.transactionId) === destinationHash);
  if (matching.length !== 1) fail("destination_ambiguity");
  const destination = matching[0]!;
  if (destination.proofClass !== "tron_solidified_usdt_destination_candidate" || destination.bridgeCompletion !== false ||
    destination.sourceMessageCorrelation !== "unverified" || hash(destination.transactionId) !== destinationHash ||
    destination.recipient !== source.tronRecipient || destination.token !== source.quotedDestinationToken ||
    positive(destination.receivedAtomic) !== positive(details.amountOut) ||
    positive(destination.minimumOutputAtomic) !== positive(source.minimumOutputAtomic)) fail("destination_binding");
  return { kind: "offline_near_tron_provider_correlation", executionAdmitted: false, bridgeCompletion: false,
    providerOutcome: "correlated_success", sourceTransactionHash: source.transactionHash,
    destinationTransactionId: destination.transactionId, transactionId: source.transactionId,
    recipient: destination.recipient, receivedAtomic: destination.receivedAtomic };
}
