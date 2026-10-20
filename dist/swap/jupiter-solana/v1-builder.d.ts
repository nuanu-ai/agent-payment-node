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
    /** Resolved against the owner policy for this exact input amount. */
    readonly resolvePayer: (profile: string, amountAtomic: string) => Promise<string>;
    readonly proveQuote: JupiterV1QuoteProof;
    readonly computeUnitPriceMicroLamports: number;
    /** Internal authoritative policy selection, never a caller-controlled pool selector. */
    readonly resolveRouteId?: (profile: string, amountAtomic: string) => Promise<JupiterV1RouteId>;
    /** Every current route the owner's policy admits for this input; the provider's answered pool selects one of them. */
    readonly resolveRouteIds?: (profile: string, amountAtomic: string) => Promise<readonly JupiterV1RouteId[]>;
    /** Canonical factory: the configured RPC supplies the frozen blockhash after the account reads (one official build). */
    readonly freezeRpcLifetime?: boolean;
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
    /** The current routes the owner's policy admits for this input, in registry order; the single-route option names one. */
    private admittedRoutes;
}
