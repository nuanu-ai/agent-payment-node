import type { Address, Hex } from "../model.js";
import { type MayanOfflineBinding } from "./mayan-offline.js";
import type { BridgeLog } from "./model.js";
/** Circle's published CCTP V1 Base mainnet deployments. */
export declare const BASE_CCTP_V1_MESSAGE_TRANSMITTER: `0x${string}`;
export declare const BASE_CCTP_V1_TOKEN_MESSENGER: `0x${string}`;
/** Circle's CCTP V1 Solana mainnet TokenMessengerMinter program. */
export declare const SOLANA_CCTP_V1_TOKEN_MESSENGER_MINTER = "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3";
export interface MayanSourceTransaction {
    readonly chainId: 8453;
    readonly hash: Hex;
    readonly from: Address;
    readonly to: Address;
    readonly input: Hex;
    readonly value: Hex;
}
export interface MayanSourceReceipt {
    readonly chainId: 8453;
    readonly transactionHash: Hex;
    readonly status: "0x1";
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly logs: readonly BridgeLog[];
}
export interface MayanSourceMessageCorrelation {
    readonly kind: "cctp_v1_mayan_source_message";
    readonly transactionId: Hex;
    readonly sourceDomain: 6;
    readonly destinationDomain: 5;
    readonly nonce: string;
    readonly messageHash: Hex;
    readonly messageTransmitter: Address;
    readonly tokenMessenger: Address;
    readonly mayanMessageSender: Address;
    readonly burnToken: Address;
    readonly burnAmountAtomic: string;
    /** CCTP mint recipient, which can be a Mayan program rather than the end user. */
    readonly mintRecipient: Hex;
    readonly destinationCaller: Hex;
    readonly bridgeCompletion: false;
}
export interface MayanSourceReceiptProof {
    readonly kind: "offline_mayan_mctp_source_receipt";
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly sourceMessageCorrelation: MayanSourceMessageCorrelation;
    readonly bridgeCompletion: false;
}
/** No RPC, provider, custody or execution dependency. Inputs must be obtained and authenticated by the caller. */
export declare function decodeMayanBaseSolanaSourceReceiptOffline(quoteValue: unknown, binding: MayanOfflineBinding, transactionValue: unknown, receiptValue: unknown): MayanSourceReceiptProof;
