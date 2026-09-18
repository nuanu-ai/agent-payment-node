import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapQuoteSnapshot } from "../quote.js";
import { type SunSwapV2Market, type SunSwapV2Pricing } from "./market.js";
import type { SunSwapSimulationProof } from "./simulation.js";
import { type SunSwapUnsignedIntent, type SunSwapUnsignedTransaction } from "./transaction.js";
export declare const SUNSWAP_EXECUTION_MATERIAL_SCHEMA: "apn.sunswap-tron-v2-execution-material.v1";
export interface SunSwapKeylessExecutionMaterial {
    readonly schemaVersion: typeof SUNSWAP_EXECUTION_MATERIAL_SCHEMA;
    readonly intent: SunSwapUnsignedIntent;
    readonly transaction: SunSwapUnsignedTransaction;
    readonly simulation: SunSwapSimulationProof;
    readonly market: SunSwapV2Market;
    readonly pricing: SunSwapV2Pricing;
    /** Chain getTransactionFee (SUN per bandwidth byte) read at quote time; it prices the bandwidth budget. */
    readonly bandwidthPriceSun: string;
}
/** Structurally a GuardedSwapPreparedMaterial: native TRX input needs no token approval, so the cap is always "0". */
export interface SunSwapPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: "0";
    readonly gasOrEnergy: Readonly<Record<string, string>>;
    readonly execution: SunSwapKeylessExecutionMaterial;
}
export interface SunSwapPreparedMaterialPort {
    save(material: SunSwapPreparedMaterial): Promise<SunSwapPreparedMaterial>;
    load(quoteHash: string): Promise<SunSwapPreparedMaterial | null>;
}
/**
 * Display of the TRON resource bound; every value derives from the frozen intent, the exact simulation and the chain
 * bandwidth price. fee_limit caps only energy, so the worst-case debit also carries the full bandwidth burn. Every
 * value is a canonical unsigned integer, as the guarded swap runtime requires of its gas or energy display.
 */
export declare function sunSwapGasOrEnergy(intent: SunSwapUnsignedIntent, simulation: SunSwapSimulationProof, transaction: SunSwapUnsignedTransaction, bandwidthPriceSun: string): Readonly<Record<string, string>>;
/** Re-derives every binding between quote, market, pricing, unsigned transaction, simulation and resource display. */
export declare function validateSunSwapPreparedMaterial(value: unknown, mode: "input" | "stored"): SunSwapPreparedMaterial;
/** Owner-private durable prepared material keyed by quoteHash; create-only and fully re-validated on every read. */
export declare class SunSwapPreparedMaterialStore extends SecureStateStore implements SunSwapPreparedMaterialPort {
    private initialized;
    save(value: SunSwapPreparedMaterial): Promise<SunSwapPreparedMaterial>;
    load(quoteHash: string): Promise<SunSwapPreparedMaterial | null>;
    private bound;
    private path;
    private ready;
}
