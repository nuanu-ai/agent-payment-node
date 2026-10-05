import type { Hex } from "../model.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
import type { Permit2ProductionSigned } from "./production-signed.js";
import { type Permit2DirectAttribution } from "./production-proxy-call.js";
export interface Permit2ReceiptLogInput {
    readonly address: string;
    readonly topics: readonly Hex[];
    readonly data: Hex;
    readonly logIndex: string;
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly removed: false;
}
export interface Permit2ReceiptInput {
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly status: "0x0" | "0x1";
    readonly logs: readonly Permit2ReceiptLogInput[];
}
export interface Permit2ReceiptFacts {
    readonly attribution: Permit2DirectAttribution;
    readonly receiptStatus: "succeeded" | "reverted_locator";
    readonly transferLogIndex: string | null;
    readonly settledLogIndex: string | null;
    /** A reverted locator cannot release a live authorization; canonical finality/expiry proof is a later observer's job. */
    readonly finality: "not_checked";
    readonly terminalAuthority: "none";
}
/** Exact projected receipt facts. Never a settlement/failure finalizer or a chain-finality proof. */
export declare function inspectPermit2ProductionReceipt(record: Permit2ProductionRecord, signed: Permit2ProductionSigned, transaction: unknown, value: unknown): Promise<Permit2ReceiptFacts>;
