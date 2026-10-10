import type { SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapQuoteSnapshot } from "../quote.js";
import { type JupiterV1ResolvedMaterial } from "./v1-material.js";
import { type JupiterV1GuardedMaterial } from "./v1-guard.js";
declare const quoteProofBrand: unique symbol;
export interface JupiterV1QuoteProof {
    readonly [quoteProofBrand]: true;
}
export interface JupiterV1QuoteProofInput {
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly slippageBps: number;
    readonly now: Date;
}
export declare function proveJupiterV1Quote(reader: Pick<SolanaRpcPort, "call">, material: JupiterV1ResolvedMaterial, input: JupiterV1QuoteProofInput, expiresAt?: string): Promise<JupiterV1QuoteProof>;
export declare function snapshotFromJupiterV1QuoteProof(proof: unknown, material: JupiterV1ResolvedMaterial, input: JupiterV1QuoteProofInput): SwapQuoteSnapshot;
export interface JupiterV1SimulationProof {
    readonly requestHash: string;
    readonly resultHash: string;
    readonly messageHash: string;
    readonly admissionDigest: string;
    readonly slot: string;
    readonly unitsConsumed: string;
    readonly recipientOutputAtomic: string;
    readonly nativeSpendLamports: string;
    readonly success: true;
}
export interface JupiterV1FinalizedReceipt {
    readonly signature: string;
    readonly slot: string;
    readonly feeLamports: string;
    readonly nativeSpendLamports: string;
    readonly recipientOutputAtomic: string;
    readonly receiptHash: string;
}
export declare function proveJupiterV1Simulation(reader: Pick<SolanaRpcPort, "call">, guarded: JupiterV1GuardedMaterial): Promise<JupiterV1SimulationProof>;
export declare function validateFinalizedJupiterV1Receipt(reader: Pick<SolanaRpcPort, "call">, g: JupiterV1GuardedMaterial, expected: {
    readonly signature: string;
}): Promise<JupiterV1FinalizedReceipt>;
/** SolanaRpc preserves JSON integer lexemes as bigint. Integers retain decimal identity without Number conversion. */
export declare function canonicalJupiterV1RpcJson(value: unknown): string;
export declare function jupiterV1RpcResponseHash(domain: string, value: unknown): string;
export {};
