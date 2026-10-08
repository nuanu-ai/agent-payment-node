import type { CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { snapshotFromJupiterV1QuoteProof, type JupiterV1QuoteProof as ProducedJupiterV1QuoteProof } from "./v1-proof.js";
import { WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
import { jupiterV1GasDisplay, assertJupiterV1FreshMaterial, validateJupiterV1PreparedMaterial, type JupiterV1ResolvedMaterial, type JupiterV1PreparedMaterial, type SavedJupiterV1MaterialStore } from "./v1-material.js";
import type { JupiterV1ReadOnlyProvider } from "./v1-provider.js";
import type { JupiterV1MaterialResolver } from "./v1-resolver.js";
import { JUPITER_V1_OLD_ROUTE, JUPITER_V1_FINITE_ROUTES, routeConfigForQuote, routeConfigForQuoteBuild, type JupiterV1RouteId } from "./v1-route-config.js";
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
export class JupiterV1QuoteBuilder implements GuardedSwapReadOnlyBuilder<JupiterV1QuoteRequest> {
    constructor(private readonly provider: JupiterV1ReadOnlyProvider, private readonly resolver: JupiterV1MaterialResolver, private readonly store: SavedJupiterV1MaterialStore, private readonly options: JupiterV1QuoteBuilderOptions) { }
    async quote(input: JupiterV1QuoteRequest & {
        readonly now: Date;
    }): Promise<unknown> {
        if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
            throw new ApnError("APN_INVALID_INPUT", "Jupiter V1 quote time is invalid.");
        const payer = await this.options.resolvePayer(input.profile);
        if (input.account !== payer || input.recipient !== payer)
            throw new ApnError("APN_INVALID_INPUT", "Jupiter V1 quoted parties differ from the owned payer.");
        const routeId = this.options.resolveRouteId === undefined ? JUPITER_V1_OLD_ROUTE.routeId : await this.options.resolveRouteId(input.profile);
        const legacy = JUPITER_V1_FINITE_ROUTES.find(route => route.routeId === routeId)?.variant === 17;
        const request = { inputMint: WRAPPED_SOL_MINT, outputMint: SOLANA_USDC_MINT, amount: input.amountAtomic, taker: payer, recipient: payer, slippageBps: input.slippageBps, computeUnitPriceMicroLamports: this.options.computeUnitPriceMicroLamports,
            ...(legacy ? { maximumInnerAccounts: 12 as const } : {}) };
        let quoteResponse;
        try {
            quoteResponse = await this.provider.quoteExactIn(request);
            routeConfigForQuote(quoteResponse, routeId);
        } catch (error) {
            // maxAccounts is only a discovery hint. One bounded official retry may
            // find the same policy-selected legacy pool. Decoder pins stay strict.
            if (!legacy || !(error instanceof ApnError) || error.code !== "APN_OPERATION_BLOCKED") throw error;
            const { maximumInnerAccounts: _hint, ...unfiltered } = request;
            quoteResponse = await this.provider.quoteExactIn(unfiltered);
            routeConfigForQuote(quoteResponse, routeId);
        }
        const build = await this.provider.buildExactIn(request, quoteResponse);
        routeConfigForQuoteBuild(quoteResponse, build, routeId);
        let execution = await this.resolver.resolve(payer, quoteResponse, build, this.options.maximumNativeExpenseLamports, undefined, routeId);
        if (this.options.refreshBuildAfterPublicReads === true) {
            const refreshed = await this.provider.buildExactIn(request, quoteResponse);
            routeConfigForQuoteBuild(quoteResponse, refreshed, routeId);
            execution = await this.resolver.refreshQuoteBuild(execution, refreshed, this.options.refreshRpcLifetimeBeforeFreeze === true);
        }
        assertJupiterV1FreshMaterial(execution);
        const produced = await this.options.proveQuote(execution, input);
        const quote = snapshotFromJupiterV1QuoteProof(produced, execution, { profile: input.profile, account: input.account, recipient: input.recipient, amountAtomic: input.amountAtomic, slippageBps: input.slippageBps, now: input.now });
        const material: JupiterV1PreparedMaterial = { quote, approvalCapAtomic: "0", gasOrEnergy: jupiterV1GasDisplay(execution), execution };
        validateJupiterV1PreparedMaterial(material);
        await this.store.save(material);
        return { quoteHash: quote.quoteHash, quote, fees: material.gasOrEnergy, mechanism: "jupiter_v1_direct_whirlpool", provenance: "runtime_bytes_only", signed: false, broadcast: false };
    }
    async load(hash: string): Promise<JupiterV1PreparedMaterial | null> { return await this.store.load(hash); }
}
