import { type Hex } from "viem";
import type { MerchantTerms } from "./terms.js";
import type { MerchantEnvelope } from "./model.js";
import type { MerchantRpcPort } from "./rpc.js";
/** v1 fee contexts only (0.5.41-0.5.43 and earlier v2 operations): the pinned GasPriceOracle identity they recorded. */
export declare const MEGA_FEE_ORACLE: {
    readonly address: `0x${string}`;
    readonly proxyHash: "0xfa8c9db6c6cab7108dea276f4cd09d575674eb0852c0fa3187e59e98ef977998";
    readonly implementation: `0x${string}`;
    readonly implementationHash: "0x4d195a9d7caf9fb6d4beaf80de252c626c853afd5868c4f4f8d19c9d301c2679";
    readonly slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    readonly version: "1.4.0";
};
interface FeeContextBody {
    readonly anchorNumber: string;
    readonly anchorHash: Hex;
    readonly unsignedBytes: string;
    readonly unsignedHash: Hex;
    readonly executionUpper: string;
    readonly l1EstimatedUpper: string;
    readonly admissionEstimatedUpper: string;
}
/** v1: the oracle's code, implementation, version and fork flags were pinned, and only a zero operator fee was accepted. */
export interface MerchantFeeContextV1 extends FeeContextBody {
    readonly schemaVersion: "apn.merchant-mega-fee.v1";
    readonly oraclePinsDigest: string;
    readonly operatorEstimatedUpper: "0";
}
/**
 * v2 (new operations, PHASE2 P5): the GasPriceOracle predeploy is read at the anchor block by address, with no code,
 * version or fork-flag pins; its L1 upper bound and operator fee enter the admission estimate. The paid fee comes from
 * the receipt's own fee fields.
 */
export interface MerchantFeeContextV2 extends FeeContextBody {
    readonly schemaVersion: "apn.merchant-mega-fee.v2";
    readonly oracle: typeof MEGA_FEE_ORACLE.address;
    readonly operatorEstimatedUpper: string;
}
export type MerchantFeeContext = MerchantFeeContextV1 | MerchantFeeContextV2;
/** The unsigned transfer the fee context prices: the operation's own token, payee and amount under its frozen envelope. */
export declare function unsignedMerchantEnvelope(e: Pick<MerchantEnvelope, "nonce" | "gas" | "maxFeePerGas" | "maxPriorityFeePerGas">, t: Pick<MerchantTerms, "token" | "payee" | "amount">): Hex;
/** Checked against what the record stored: v1 against the oracle pins it recorded, v2 against the oracle address alone. */
export declare function validateMerchantFeeContext(v: unknown, e: MerchantEnvelope, t: Pick<MerchantTerms, "token" | "payee" | "amount">): MerchantFeeContext;
/** Exact canonical oracle identity and zero-only operator contract; both estimation and inclusion use this pin. */
export declare function merchantOracleAt(rpc: MerchantRpcPort, number: string, blockHash: Hex, gas: bigint, unsignedBytes?: bigint): Promise<bigint>;
/** The admission fee estimate at one anchor. `pinned` (v1 records) keeps the oracle pins; new operations read by address only. */
export declare function merchantFeeQuote(rpc: MerchantRpcPort, head: Record<string, unknown>, e: MerchantEnvelope, t: Pick<MerchantTerms, "token" | "payee" | "amount">, pinned: boolean): Promise<MerchantFeeContext>;
export declare function checkMerchantFullFee(fresh: MerchantFeeContext, frozen: MerchantFeeContext, e: MerchantEnvelope, native: string, t: Pick<MerchantTerms, "token" | "payee" | "amount">): void;
export interface MerchantPaidFee {
    readonly execution: string;
    readonly l1: string;
    readonly operator: string;
    readonly total: string;
}
/** v1 fee rule: L1 is additional to receipt execution cost. Missing quantities/unsupported nonzero operator fields refuse. */
export declare function merchantActualFee(r: Record<string, unknown>): MerchantPaidFee;
/**
 * v2 fee rule (new operations): the paid fee from the receipt's own fields, as LI.FI's bridgeActualFees reads Base:
 * execution plus `l1Fee` plus the Jovian operator fee (gasUsed * operatorFeeScalar * 100 + operatorFeeConstant).
 */
export declare function merchantReceiptFee(r: Record<string, unknown>): MerchantPaidFee;
/** Block-wide payer debit witness is explicit; it never attributes a two-transaction delta to one target. */
export declare function merchantPayerDebit(rpc: MerchantRpcPort, owner: string, blockValue: unknown, target: Record<string, unknown>, budget: string, feeOf?: (r: Record<string, unknown>) => MerchantPaidFee): Promise<{
    before: string;
    after: string;
    aggregateDebit: string;
    transactionHashes: readonly Hex[];
    evidenceHash: string;
}>;
export {};
