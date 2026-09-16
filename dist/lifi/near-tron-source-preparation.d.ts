/** Read-only preparation of an unchecked NEAR/1Click Base source call. No execution imports. */
import { type Address, type Hex } from "viem";
import { type NearTronPreflightPins, type NearTronReadOnlyRpc } from "./near-tron-preflight.js";
export interface NearTronSourcePreparationInput {
    /** Reloaded draft (repository load or equivalent); never a projection of its unchecked fields. */
    readonly draft: unknown;
    readonly quote: unknown;
    readonly pins: NearTronPreflightPins;
    readonly rpc: NearTronReadOnlyRpc;
}
export interface NearTronSourcePreparation {
    readonly kind: "read_only_near_tron_source_preparation";
    readonly executionAdmitted: false;
    /** This artifact is derived from caller-supplied quote and RPC data; it is never an execution approval. */
    readonly evidenceTrust: "untrusted_quote_and_rpc";
    readonly draftIntegrityHash: string;
    readonly quoteHash: string;
    readonly quoteId: Hex;
    readonly preflightBlockHash: Hex;
    readonly sourceCall: Readonly<{
        chainId: 8453;
        from: Address;
        to: Address;
        valueAtomic: string;
        data: Hex;
        dataSha256: string;
        type: "eip1559";
        nonceAtomic: string;
        gasLimitAtomic: string;
        maxFeePerGasAtomic: string;
        maxPriorityFeePerGasAtomic: string;
        accessList: readonly [];
    }>;
    readonly maxSourceNativeDebitWei: string;
    readonly preparationDigest: string;
}
/** Every RPC is injected, read-only and repeated against the exact quote immediately before the envelope is returned. */
export declare function prepareNearTronBaseSourceReadOnly(input: NearTronSourcePreparationInput): Promise<NearTronSourcePreparation>;
