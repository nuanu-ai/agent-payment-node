import { SecureStateStore } from "../secure-state-store.js";
import { type Hex } from "viem";
export interface OneClickSourceRecord {
    readonly schemaVersion: "apn.oneclick-source.v1";
    readonly operationId: string;
    readonly profileHash: string;
    readonly payer: string;
    readonly recipient: string;
    readonly refundTo: string;
    readonly depositAddress: string;
    readonly quoteHash: string;
    readonly quoteRequestDeadline: string;
    readonly quoteDeadline: string;
    readonly effectiveDeadline: string;
    readonly amountInAtomic: string;
    readonly minAmountOutAtomic: string;
    readonly quotedAmountOutAtomic: string;
    readonly sourceBlockHash: string;
    readonly sourceCall: {
        readonly to: string;
        readonly data: Hex;
        readonly nonce: string;
        readonly gas: string;
        readonly maxFeePerGas: string;
        readonly maxPriorityFeePerGas: string;
        readonly maxNativeDebitWei: string;
    };
    readonly phase: "prepared" | "signing_started" | "sealed" | "submitting" | "submitted_pending" | "unknown_finality" | "source_observed";
    readonly rawTransaction: Hex | null;
    readonly transactionHash: Hex | null;
    readonly submissionAttempts: 0 | 1;
    readonly sourceReceiptStatus: "success" | "reverted" | null;
    readonly sourceReceiptHash: string | null;
    readonly destinationStatus: null;
    readonly updatedAt: string;
    readonly integrityHash: string;
}
export declare class OneClickSourceJournal extends SecureStateStore {
    private path;
    load(id: string): Promise<OneClickSourceRecord | null>;
    stage(body: Omit<OneClickSourceRecord, "schemaVersion" | "phase" | "rawTransaction" | "transactionHash" | "submissionAttempts" | "sourceReceiptStatus" | "sourceReceiptHash" | "destinationStatus" | "updatedAt" | "integrityHash">): Promise<OneClickSourceRecord>;
    advance(id: string, expectedHash: string, phase: OneClickSourceRecord["phase"], changes?: Partial<OneClickSourceRecord>): Promise<OneClickSourceRecord>;
}
