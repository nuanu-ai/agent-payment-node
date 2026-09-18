import { SecureStateStore } from "../../../secure-state-store.js";
import { type SwapOperationRecord } from "../../model.js";
declare const EVIDENCE_VERSION = "apn.uniswap-balance-evidence.v1";
/**
 * Native and output-token balances around the swap block, read on first sight of the receipt while a pruning full
 * node still serves that state (about the last 128 blocks). Finality comes 65–95 blocks later, so a status call made
 * after that window reuses this evidence instead of needing historical state. It is valid only for the exact block
 * hash it names; after a reorg the observer reads it again.
 */
export interface UniswapBalanceEvidence {
    readonly schemaVersion: typeof EVIDENCE_VERSION;
    readonly operationId: string;
    readonly transactionHash: `0x${string}`;
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
    readonly beforeNative: string;
    readonly afterNative: string;
    readonly beforeOutput: string;
    readonly afterOutput: string;
    readonly capturedAt: string;
    readonly evidenceHash: string;
}
export type UniswapBalanceEvidenceBody = Omit<UniswapBalanceEvidence, "schemaVersion" | "evidenceHash">;
export interface UniswapBalanceEvidencePort {
    load(operation: SwapOperationRecord): Promise<UniswapBalanceEvidence | null>;
    save(operation: SwapOperationRecord, evidence: UniswapBalanceEvidence): Promise<UniswapBalanceEvidence>;
}
export declare function sealUniswapBalanceEvidence(body: UniswapBalanceEvidenceBody): UniswapBalanceEvidence;
export declare function validateUniswapBalanceEvidence(value: unknown, operation: SwapOperationRecord): UniswapBalanceEvidence;
export declare class UniswapBalanceEvidenceStore extends SecureStateStore implements UniswapBalanceEvidencePort {
    private initialized;
    load(operationValue: SwapOperationRecord): Promise<UniswapBalanceEvidence | null>;
    /** Keeps the first evidence for a block; evidence for a different block hash (after a reorg) replaces it. */
    save(operationValue: SwapOperationRecord, evidenceValue: UniswapBalanceEvidence): Promise<UniswapBalanceEvidence>;
    private path;
    private ready;
}
export {};
