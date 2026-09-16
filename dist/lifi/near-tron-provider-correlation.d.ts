/** Offline correlation of frozen provider responses with independently parsed chain candidates.
 * The caller is responsible for acquiring and authenticating each response.
 * This module never admits execution or declares bridge settlement.
 * Schema references: docs.li.fi/agents/reference/endpoint-specs GET /status and
 * docs.near-intents.org/api-reference/oneclick/check-swap-execution-status.
 */
import type { NearTronSourceDepositCandidate } from "./near-tron-source-receipt.js";
import type { TronDestinationCandidate } from "./tron-destination-candidate.js";
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
export declare function correlateNearTronProviderStatusOffline(source: NearTronSourceDepositCandidate, lifiRaw: unknown, nearRaw: unknown, destinationCandidates: readonly TronDestinationCandidate[]): NearTronProviderCorrelation;
