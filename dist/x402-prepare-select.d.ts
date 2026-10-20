import type { Address, Hex } from "./model.js";
import type { RpcPort } from "./ports.js";
import type { InspectCandidate } from "./x402-model.js";
import type { X402Asset } from "./x402-network.js";
import { type FreshChallenge, type SelectedPrepareOffer } from "./x402-policy.js";
/** What prepare freezes from its single pinned chain read, whichever method the offer uses. */
export interface X402PrepareRead {
    readonly selected: SelectedPrepareOffer;
    readonly balanceAtomic: string;
    readonly block: {
        readonly number: string;
        readonly hash: Hex;
        readonly timestamp: string;
    };
    readonly observedAt: string;
    /** The token's on-chain decimals(), read for every token outside the released USDC pairs. */
    readonly decimals?: number;
}
export interface X402PrepareReadInput {
    /** Named in the refusal that asks the owner for an allowance to Permit2. */
    readonly profile: string;
    readonly rpc: RpcPort;
    readonly rpcOrigin: string;
    readonly discovered: FreshChallenge;
    /** Offers of the selected chain+token within the owner's cap and payee pin, in seller index order. */
    readonly underCap: readonly InspectCandidate[];
    readonly wallet: Address;
    readonly asset: X402Asset;
    readonly transferMethod: "eip3009" | "erc7710";
    /** Only APN's own local signer signs Permit2 witness transfers. */
    readonly permit2Signer: boolean;
    readonly nonce: Hex;
    readonly startedAtMs: number;
    readonly nowMs: () => number;
}
/**
 * The deterministic method rule: EIP-3009 when the seller offers it for this chain+token (no allowance needed), else
 * Permit2 when the payer is the local wallet; the lowest-index offer of that method that fits the balance (and, for
 * Permit2, the allowance or a seller-sponsored permit) wins. An operation never changes method afterwards.
 */
export declare function readAndSelectX402Offer(input: X402PrepareReadInput): Promise<X402PrepareRead>;
/**
 * The seller's payment-identifier declaration the operation binds. The Permit2 wire carries no extension besides the
 * sponsored permit, so a Permit2 payment omits an optional identifier and refuses a required one.
 */
export declare function x402PaymentIdentifier(paymentRequired: FreshChallenge["paymentRequired"], operationId: string, method: "eip3009" | "erc7710" | "permit2"): {
    readonly declarationCanonicalJson: string;
    readonly declarationHash: string;
    readonly value: string;
} | undefined;
