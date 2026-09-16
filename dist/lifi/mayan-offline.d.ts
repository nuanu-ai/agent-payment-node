import type { Address, Hex } from "../model.js";
export interface MayanOfflineBinding {
    /** Public synthetic or independently supplied source address; never a private key. */
    readonly sender: Address;
    readonly solanaRecipient: string;
    readonly sourceAmountAtomic: string;
    readonly maxFeeAtomic: string;
}
export interface MayanOfflineDecode {
    readonly kind: "offline_mayan_mctp_source_inspection";
    readonly bridgeCompletion: false;
    readonly sourceChainId: 8453;
    readonly destinationChainId: 1151111081099710;
    readonly sourceToken: Address;
    readonly destinationToken: string;
    readonly sender: Address;
    readonly solanaRecipient: string;
    readonly approvalSpender: Address;
    readonly transactionTarget: Address;
    readonly transactionId: Hex;
    readonly sourceAmountAtomic: string;
    /** LI.FI FeeForwarder fee, taken from the source amount. */
    readonly lifiFeeAmountAtomic: string;
    readonly bridgeAmountAtomic: string;
    /** Mayan redemption fee parameter in bridgeWithFee; separate from the LI.FI fee. */
    readonly mayanRedeemFeeAtomic: string;
    /** API estimate only. Not an onchain destination guarantee in this call. */
    readonly offchainToAmountMinAtomic: string;
    readonly mayanProtocol: Address;
    readonly mayanDestinationDomain: number;
    readonly refundRecipient: Address;
    readonly calldataSha256: string;
}
export declare function decodeMayanBaseSolanaQuoteOffline(quoteValue: unknown, binding: MayanOfflineBinding): MayanOfflineDecode;
