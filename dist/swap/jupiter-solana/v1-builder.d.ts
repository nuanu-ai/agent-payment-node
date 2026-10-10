import type { CommandRequest } from "../../commands.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { type JupiterV1QuoteProof as ProducedJupiterV1QuoteProof } from "./v1-proof.js";
import { type JupiterV1ResolvedMaterial, type JupiterV1PreparedMaterial, type SavedJupiterV1MaterialStore } from "./v1-material.js";
import type { JupiterV1ReadOnlyProvider } from "./v1-provider.js";
import type { JupiterV1MaterialResolver } from "./v1-resolver.js";
import { type JupiterV1RouteId } from "./v1-route-config.js";
export type JupiterV1QuoteRequest = Extract<CommandRequest, {
    readonly command: "swap.jupiter.quote";
}>;
/** Requires the capability issued by the semantic guard and exact-message simulation producer. */
export type JupiterV1QuoteProof = (material: JupiterV1ResolvedMaterial, input: JupiterV1QuoteRequest & {
    readonly now: Date;
}) => Promise<ProducedJupiterV1QuoteProof>;
export interface JupiterV1QuoteBuilderOptions {
    readonly resolvePayer: (profile: string) => Promise<string>;
    readonly proveQuote: JupiterV1QuoteProof;
    readonly maximumNativeExpenseLamports: string;
    readonly computeUnitPriceMicroLamports: number;
    /** Internal authoritative policy selection, never a caller-controlled pool selector. */
    readonly resolveRouteId?: (profile: string) => Promise<JupiterV1RouteId>;
    /** Canonical factory only: obtain the final official lifetime after bulky public code reads. */
    readonly refreshBuildAfterPublicReads?: boolean;
    readonly refreshRpcLifetimeBeforeFreeze?: boolean;
}
export declare class JupiterV1QuoteBuilder implements GuardedSwapReadOnlyBuilder<JupiterV1QuoteRequest> {
    private readonly provider;
    private readonly resolver;
    private readonly store;
    private readonly options;
    constructor(provider: JupiterV1ReadOnlyProvider, resolver: JupiterV1MaterialResolver, store: SavedJupiterV1MaterialStore, options: JupiterV1QuoteBuilderOptions);
    quote(input: JupiterV1QuoteRequest & {
        readonly now: Date;
    }): Promise<unknown>;
    load(hash: string): Promise<JupiterV1PreparedMaterial | null>;
}
