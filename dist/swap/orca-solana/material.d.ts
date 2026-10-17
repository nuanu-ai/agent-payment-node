import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapQuoteSnapshot } from "../quote.js";
import type { GuardedSwapPreparedMaterial } from "../runtime.js";
import type { SolanaProgramObservation } from "../solana-program-authority.js";
import { type OrcaNativeSwapPlan, type OrcaSwapLifetime, type OrcaSwapPlan, type OrcaTokenSwapPlan } from "./instructions.js";
import type { WhirlpoolSwapQuote } from "./math.js";
import type { OrcaPoolView } from "./market.js";
import type { OrcaOwnerBalances, OrcaSimulationEvidence, OrcaTokenOwnerBalances, OrcaTokenSimulationEvidence } from "./simulation.js";
export declare const ORCA_KEYLESS_EXECUTION_SCHEMA: "apn.orca-whirlpool-keyless-execution.v1";
export declare const ORCA_TOKEN_EXECUTION_SCHEMA: "apn.orca-whirlpool-keyless-token-execution.v1";
export declare const ORCA_EVIDENCE_DOMAIN: "apn.orca-whirlpool-onchain-evidence.v1";
export declare const ORCA_ROUTE_DOMAIN: "apn.orca-whirlpool-route.v1";
import { ORCA_MAX_SLOT_DRIFT } from "./accounts.js";
export { ORCA_MAX_SLOT_DRIFT };
export declare const SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE = 5000n;
type ProgramPins = readonly (SolanaProgramObservation | {
    readonly role: string;
    readonly address: string;
    readonly dataSha256: string;
})[];
/** Read-only chain facts behind one sol-usdc quote. Its domain hash is the quote's providerResponseHash. */
export interface OrcaQuoteEvidence {
    readonly slot: string;
    readonly pool: OrcaPoolView;
    readonly accountDataSha256: Readonly<Record<string, string>>;
    readonly tickArrayStarts: readonly number[];
    readonly vaultSolLamports: string;
    readonly vaultUsdcAtomic: string;
    readonly owner: OrcaOwnerBalances;
    readonly tokenAccountRentLamports: string;
    /** Program authority observations; operations quoted by APN 0.5.42 and earlier hold {role, address, dataSha256} byte pins. */
    readonly programPins: ProgramPins;
    readonly swap: WhirlpoolSwapQuote;
}
/** Read-only chain facts behind one token-input quote. */
export interface OrcaTokenQuoteEvidence {
    readonly slot: string;
    readonly pool: OrcaPoolView;
    readonly accountDataSha256: Readonly<Record<string, string>>;
    readonly tickArrayStarts: readonly number[];
    readonly vaultAAtomic: string;
    readonly vaultBAtomic: string;
    readonly owner: OrcaTokenOwnerBalances;
    readonly tokenAccountRentLamports: string;
    readonly programPins: readonly SolanaProgramObservation[];
    readonly swap: WhirlpoolSwapQuote;
}
interface ExecutionCommon {
    readonly lifetime: OrcaSwapLifetime;
    readonly unsignedPayload: string;
    readonly messageHash: string;
    readonly networkFeeLamports: string;
    readonly maximumSolSpendLamports: string;
    readonly ownerSlippageCapBps: number;
}
export interface OrcaKeylessExecution extends ExecutionCommon {
    readonly schemaVersion: typeof ORCA_KEYLESS_EXECUTION_SCHEMA;
    readonly plan: OrcaNativeSwapPlan;
    readonly usdcAccountRentLamports: string;
    readonly evidence: OrcaQuoteEvidence;
    readonly simulation: OrcaSimulationEvidence;
}
export interface OrcaTokenExecution extends ExecutionCommon {
    readonly schemaVersion: typeof ORCA_TOKEN_EXECUTION_SCHEMA;
    readonly plan: OrcaTokenSwapPlan;
    readonly destinationAccountRentLamports: string;
    readonly evidence: OrcaTokenQuoteEvidence;
    readonly simulation: OrcaTokenSimulationEvidence;
}
export interface OrcaKeylessMaterial extends GuardedSwapPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: "0";
    readonly execution: OrcaKeylessExecution | OrcaTokenExecution;
}
export declare function orcaEvidenceHash(evidence: OrcaQuoteEvidence | OrcaTokenQuoteEvidence): string;
export declare function orcaRouteHash(plan: OrcaSwapPlan): string;
/** The quote's `blockHash` is the message blockhash as 0x-prefixed hex, so the core's simulation schema stays exact. */
export declare function blockhashHex(value: string): string;
/** Priority fee in lamports: ceil(limit * micro-lamports / 1e6). */
export declare function priorityFeeLamports(plan: Pick<OrcaSwapPlan, "computeUnitLimit" | "computeUnitPriceMicroLamports">): bigint;
/** The new account rent the owner approved: the USDC account for sol-usdc, the destination account for a token pool. */
export declare function orcaApprovedRent(execution: OrcaKeylessExecution | OrcaTokenExecution): string;
/** The output the simulation credited to the owner, whichever execution schema produced it. */
export declare function orcaSimulatedOutput(simulation: OrcaSimulationEvidence | OrcaTokenSimulationEvidence): unknown;
export declare function orcaGasDisplay(execution: Pick<OrcaKeylessExecution, "plan" | "networkFeeLamports" | "usdcAccountRentLamports" | "maximumSolSpendLamports" | "simulation" | "evidence">): Readonly<Record<string, string>>;
export declare function orcaTokenGasDisplay(execution: Pick<OrcaTokenExecution, "plan" | "networkFeeLamports" | "destinationAccountRentLamports" | "maximumSolSpendLamports" | "simulation">): Readonly<Record<string, string>>;
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
