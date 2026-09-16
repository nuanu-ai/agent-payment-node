import type { Address, Hex } from "../model.js";
export declare const BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES: `0x${string}`;
export declare const BASE_CCTP_V2_TOKEN_MESSENGER: `0x${string}`;
export declare const BASE_CCTP_V2_MESSAGE_TRANSMITTER: `0x${string}`;
export declare const SOLANA_CCTP_V2_TOKEN_MESSENGER_MINTER = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
export interface CircleV2BurnIntent {
    readonly sourceTransactionHash: Hex;
    readonly sourceFrom: Address;
    readonly amountAtomic: string;
    /** Existing Solana USDC ATA, encoded as its raw 32-byte public key. */
    readonly solanaAtaBytes32: Hex;
    readonly maxFeeAtomic: string;
    readonly minFinalityThreshold: number;
    readonly hookData: Hex;
}
export interface CircleV2SourceProof {
    readonly kind: "offline_circle_cctp_v2_base_source_receipt";
    readonly sourceTransactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly sourceDomain: 6;
    readonly destinationDomain: 5;
    readonly burnToken: Address;
    readonly burnAmountAtomic: string;
    readonly depositor: Address;
    readonly mintRecipient: Hex;
    readonly destinationTokenMessenger: Hex;
    readonly destinationCaller: Hex;
    readonly maxFeeAtomic: string;
    readonly minFinalityThreshold: number;
    readonly hookData: Hex;
    readonly message: Hex;
    readonly messageHash: Hex;
    readonly executionAdmitted: false;
    readonly bridgeCompletion: false;
}
/** No RPC, network, signer, provider, or execution dependency. A successful safe receipt is caller-authenticated input. */
export declare function decodeCircleV2BaseSourceReceiptOffline(intent: CircleV2BurnIntent, transactionValue: unknown, receiptValue: unknown): CircleV2SourceProof;
