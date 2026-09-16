import { type CircleV2BurnIntent } from "./circle-v2-source-receipt.js";
import { type CircleV2SolanaDestinationInput } from "./circle-v2-solana-destination-offline.js";
export interface CircleV2DeliveryOfflineInput {
    readonly intent: CircleV2BurnIntent;
    /** Caller authenticated safe Base transaction and receipt. */
    readonly sourceTransaction: unknown;
    readonly sourceReceipt: unknown;
    /** Caller supplied, unauthenticated Iris JSON response. */
    readonly irisResponse: unknown;
    /** Caller authenticated finalized Solana RPC observations. */
    readonly destination: Omit<CircleV2SolanaDestinationInput, "attestedMessageHex" | "nonceHex" | "expectedAttestationHex">;
}
export declare function inspectCircleV2BaseSolanaDeliveryOffline(input: CircleV2DeliveryOfflineInput): Promise<{
    kind: "offline_circle_cctp_v2_base_solana_delivery_candidate";
    sourceTransactionHash: `0x${string}`;
    sourceMessageHash: `0x${string}`;
    attestedMessageHash: `0x${string}`;
    destinationSignature: string;
    destinationTokenAccount: string;
    amountAtomic: string;
    feeExecutedAtomic: string;
    receivedAtomic: string;
    nonce: string;
    source: import("./circle-v2-source-receipt.js").CircleV2SourceProof;
    iris: import("./circle-v2-iris-offline.js").CircleV2IrisHint;
    destination: {
        proofClass: "circle_v2_solana_mint_event_candidate";
        sourceMessageCorrelation: "receive_cpi_mint_transfer_events_matched";
        executionAdmitted: false;
        bridgeCompletion: false;
        blockers: string[];
        nonceHex: string;
        usedNoncePda: import("@solana/addresses").Address<string>;
        signature: string;
        slotAtomic: string;
        recipient: string;
        tokenAccount: string;
        mint: typeof import("../chain-policy.js").SOLANA_USDC;
        receivedAtomic: string;
        minimumOutputAtomic: string;
    };
    provenance: "synthetic_untrusted_caller_supplied_offline_observations";
    attestationAuthenticated: false;
    chainAuthenticityVerified: false;
    executionAdmitted: false;
    bridgeCompletion: false;
}>;
