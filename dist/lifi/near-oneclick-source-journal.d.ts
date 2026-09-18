import { SecureStateStore } from "../secure-state-store.js";
import { type Hex } from "viem";
import { type OneClickLane, type OneClickLaneId } from "./near-oneclick-lanes.js";
export interface OneClickSourceRecord {
    readonly schemaVersion: "apn.oneclick-source.v1" | "apn.oneclick-source.v2" | "apn.oneclick-source.v3";
    /** Present only in v3. v1 and v2 records are the legacy Base USDC to TRON USDT lane. */
    readonly lane?: OneClickLaneId;
    readonly operationId: string;
    readonly profileHash: string;
    readonly payer: string;
    readonly recipient: string;
    readonly refundTo: string;
    readonly depositAddress: string;
    /** v3 native lanes only: the deposit address code class observed at the pinned source block. */
    readonly depositCode?: "eoa" | "contract";
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
        readonly value?: string;
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
export declare function oneClickRecordLane(record: Pick<OneClickSourceRecord, "schemaVersion" | "lane">): OneClickLane;
/** The exact source effect for a lane: an ERC20 transfer to the deposit, or exactly amountIn wei to the deposit. */
export declare function oneClickSourceCall(lane: OneClickLane, depositAddress: string, amountInAtomic: string): {
    to: string;
    data: Hex;
    value: string;
};
export declare class OneClickSourceJournal extends SecureStateStore {
    private path;
    load(id: string): Promise<OneClickSourceRecord | null>;
    stage(body: Omit<OneClickSourceRecord, "schemaVersion" | "phase" | "rawTransaction" | "transactionHash" | "submissionAttempts" | "sourceReceiptStatus" | "sourceReceiptHash" | "destinationStatus" | "updatedAt" | "integrityHash"> & {
        readonly lane: OneClickLaneId;
    }): Promise<OneClickSourceRecord>;
    advance(id: string, expectedHash: string, phase: OneClickSourceRecord["phase"], changes?: Partial<OneClickSourceRecord>): Promise<OneClickSourceRecord>;
}
