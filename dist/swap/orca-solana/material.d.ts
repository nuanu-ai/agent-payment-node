import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapQuoteSnapshot } from "../quote.js";
import type { GuardedSwapPreparedMaterial } from "../runtime.js";
import { type OrcaSwapLifetime, type OrcaSwapPlan } from "./instructions.js";
import type { WhirlpoolSwapQuote } from "./math.js";
import type { OrcaOwnerBalances, OrcaSimulationEvidence } from "./simulation.js";
export declare const ORCA_KEYLESS_EXECUTION_SCHEMA: "apn.orca-whirlpool-keyless-execution.v1";
export declare const ORCA_EVIDENCE_DOMAIN: "apn.orca-whirlpool-onchain-evidence.v1";
export declare const ORCA_ROUTE_DOMAIN: "apn.orca-whirlpool-route.v1";
/** Slots between the account read and the simulation; the quote refuses beyond it. */
export declare const ORCA_MAX_SLOT_DRIFT = 150;
export declare const SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE = 5000n;
/** Read-only chain facts behind one quote. Its domain hash is the quote's providerResponseHash. */
export interface OrcaQuoteEvidence {
    readonly slot: string;
    readonly pool: {
        readonly address: string;
        readonly tickSpacing: number;
        readonly feeRate: number;
        readonly protocolFeeRate: number;
        readonly liquidity: string;
        readonly sqrtPrice: string;
        readonly tickCurrentIndex: number;
    };
    readonly accountDataSha256: Readonly<Record<string, string>>;
    readonly tickArrayStarts: readonly number[];
    readonly vaultSolLamports: string;
    readonly vaultUsdcAtomic: string;
    readonly owner: OrcaOwnerBalances;
    readonly tokenAccountRentLamports: string;
    readonly programPins: readonly {
        readonly role: string;
        readonly address: string;
        readonly dataSha256: string;
    }[];
    readonly swap: WhirlpoolSwapQuote;
}
export interface OrcaKeylessExecution {
    readonly schemaVersion: typeof ORCA_KEYLESS_EXECUTION_SCHEMA;
    readonly plan: OrcaSwapPlan;
    readonly lifetime: OrcaSwapLifetime;
    readonly unsignedPayload: string;
    readonly messageHash: string;
    readonly networkFeeLamports: string;
    readonly usdcAccountRentLamports: string;
    readonly maximumSolSpendLamports: string;
    readonly ownerSlippageCapBps: number;
    readonly evidence: OrcaQuoteEvidence;
    readonly simulation: OrcaSimulationEvidence;
}
export interface OrcaKeylessMaterial extends GuardedSwapPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: "0";
    readonly execution: OrcaKeylessExecution;
}
export declare function orcaEvidenceHash(evidence: OrcaQuoteEvidence): string;
export declare function orcaRouteHash(plan: OrcaSwapPlan): string;
/** The quote's `blockHash` is the message blockhash as 0x-prefixed hex, so the core's simulation schema stays exact. */
export declare function blockhashHex(value: string): string;
/** Priority fee in lamports: ceil(limit * micro-lamports / 1e6). */
export declare function priorityFeeLamports(plan: Pick<OrcaSwapPlan, "computeUnitLimit" | "computeUnitPriceMicroLamports">): bigint;
export declare function orcaGasDisplay(execution: Pick<OrcaKeylessExecution, "plan" | "networkFeeLamports" | "usdcAccountRentLamports" | "maximumSolSpendLamports" | "simulation" | "evidence">): Readonly<Record<string, string>>;
/** Proves the stored plan, bytes, fee display and chain evidence are exactly the ones the quote hash binds. */
export declare function validateOrcaKeylessMaterial(value: unknown, mode?: "input" | "stored"): OrcaKeylessMaterial;
/** Saved-quote store: GuardedSwapReadOnlyBuilder.load resolves prepared material here by quote hash. */
export declare class SavedOrcaQuoteStore extends SecureStateStore {
    private initialized;
    save(value: OrcaKeylessMaterial): Promise<OrcaKeylessMaterial>;
    load(quoteHash: string): Promise<OrcaKeylessMaterial | null>;
    private path;
    private ready;
}
