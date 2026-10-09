import { type Hex } from "viem";
import type { MerchantEnvelope } from "./model.js";
import type { MerchantRpcPort } from "./rpc.js";
export declare const MEGA_FEE_ORACLE: {
    readonly address: `0x${string}`;
    readonly proxyHash: "0xfa8c9db6c6cab7108dea276f4cd09d575674eb0852c0fa3187e59e98ef977998";
    readonly implementation: `0x${string}`;
    readonly implementationHash: "0x4d195a9d7caf9fb6d4beaf80de252c626c853afd5868c4f4f8d19c9d301c2679";
    readonly slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    readonly version: "1.4.0";
};
export interface MerchantFeeContext {
    readonly schemaVersion: "apn.merchant-mega-fee.v1";
    readonly anchorNumber: string;
    readonly anchorHash: Hex;
    readonly oraclePinsDigest: string;
    readonly unsignedBytes: string;
    readonly unsignedHash: Hex;
    readonly executionUpper: string;
    readonly l1EstimatedUpper: string;
    readonly operatorEstimatedUpper: "0";
    readonly admissionEstimatedUpper: string;
}
export declare function unsignedMerchantEnvelope(e: Pick<MerchantEnvelope, "nonce" | "gas" | "maxFeePerGas" | "maxPriorityFeePerGas">): Hex;
export declare function validateMerchantFeeContext(v: unknown, e: MerchantEnvelope): MerchantFeeContext;
/** Exact canonical oracle identity and zero-only operator contract; both estimation and inclusion use this pin. */
export declare function merchantOracleAt(rpc: MerchantRpcPort, number: string, blockHash: Hex, gas: bigint, unsignedBytes?: bigint): Promise<bigint>;
export declare function merchantFeeQuote(rpc: MerchantRpcPort, head: Record<string, unknown>, e: MerchantEnvelope): Promise<MerchantFeeContext>;
export declare function checkMerchantFullFee(fresh: MerchantFeeContext, frozen: MerchantFeeContext, e: MerchantEnvelope, native: string): void;
/** L1 is additional to receipt execution cost. Missing quantities/unsupported nonzero operator fields refuse. */
export declare function merchantActualFee(r: Record<string, unknown>): {
    execution: string;
    l1: string;
    operator: "0";
    total: string;
};
/** Block-wide payer debit witness is explicit; it never attributes a two-transaction delta to one target. */
export declare function merchantPayerDebit(rpc: MerchantRpcPort, owner: string, blockValue: unknown, target: Record<string, unknown>, budget: string): Promise<{
    before: string;
    after: string;
    aggregateDebit: string;
    transactionHashes: readonly Hex[];
    evidenceHash: string;
}>;
