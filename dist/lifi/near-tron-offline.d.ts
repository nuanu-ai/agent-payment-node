import type { Address, Hex } from "../model.js";
export interface NearTronOfflineBinding {
    readonly sender: Address;
    readonly tronRecipient: string;
    readonly sourceAmountAtomic: string;
    readonly maxFeeAtomic: string;
    readonly minOutputAtomic: string;
}
export interface NearTronOfflineInspection {
    readonly kind: "offline_near_tron_source_inspection";
    readonly executionAdmitted: false;
    readonly bridgeCompletion: false;
    /** Raw TRON 20-byte account payload matches the facet's bytes32 field. */
    readonly destinationBinding: "tron_account_payload_matches";
    readonly sourceChainId: 8453;
    readonly apiDestinationChainId: 728126428;
    readonly facetDestinationChainId: string;
    readonly sourceToken: Address;
    /** Provider quote metadata only; the facet calldata does not bind this address. */
    readonly quotedDestinationToken: string;
    readonly quotedTronRecipient: string;
    readonly facetNonEvmReceiver: Hex;
    readonly expectedTronAddressWord: Hex;
    readonly transactionTarget: Address;
    readonly approvalSpender: Address;
    readonly sourceAmountAtomic: string;
    readonly feeAmountAtomic: string;
    readonly bridgeAmountAtomic: string;
    readonly offchainMinimumOutputAtomic: string;
    readonly facetMinimumOutputAtomic: string;
    readonly depositAddress: Address;
    readonly quoteId: Hex;
    readonly deadline: string;
    readonly calldataSha256: string;
}
/** Inspect source bytes only; never admit or complete a bridge operation. */
export declare function inspectNearBaseTronQuoteOffline(value: unknown, binding: NearTronOfflineBinding): NearTronOfflineInspection;
