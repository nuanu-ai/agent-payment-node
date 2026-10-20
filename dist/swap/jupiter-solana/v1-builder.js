import { ApnError } from "../../errors.js";
import { snapshotFromJupiterV1QuoteProof } from "./v1-proof.js";
import { WRAPPED_SOL_MINT, SOLANA_USDC_MINT, SOLANA_MAINNET_GENESIS } from "./catalog.js";
import { jupiterV1MaximumNativeExpense } from "./v1-guard.js";
import { jupiterV1GasDisplay, assertJupiterV1FreshMaterial, validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { JUPITER_V1_ROUTES, routeConfigForQuoteBuild } from "./v1-route-config.js";
export class JupiterV1QuoteBuilder {
    provider;
    resolver;
    store;
    options;
    constructor(provider, resolver, store, options) {
        this.provider = provider;
        this.resolver = resolver;
        this.store = store;
        this.options = options;
    }
    async quote(input) {
        if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
            throw new ApnError("APN_INVALID_INPUT", "Jupiter V1 quote time is invalid.");
        const payer = await this.options.resolvePayer(input.profile, input.amountAtomic);
        if (input.account !== payer || input.recipient !== payer)
            throw new ApnError("APN_INVALID_INPUT", "Jupiter V1 quoted parties differ from the owned payer.");
        const admitted = await this.admittedRoutes(input.profile, input.amountAtomic);
        const base = { inputMint: WRAPPED_SOL_MINT, outputMint: SOLANA_USDC_MINT, amount: input.amountAtomic, taker: payer, recipient: payer, slippageBps: input.slippageBps, computeUnitPriceMicroLamports: this.options.computeUnitPriceMicroLamports };
        const hinted = { ...base, maximumInnerAccounts: 12 };
        // Jupiter's quote API takes no pool selector: it answers its best-priced direct Whirlpool pool. Any pool the owner's
        // policy admits is taken (the unfiltered best first when a SwapV2 pool is admitted). maxAccounts is only a discovery
        // hint toward the legacy-ABI pools; one bounded second read may use or drop it. Decoder pins stay strict.
        const attempts = admitted.some(route => route.variant === 47) ? [base, ...(admitted.some(route => route.variant === 17) ? [hinted] : [])] : [hinted, base];
        const returnedPools = [];
        let selected;
        for (const request of attempts) {
            let quoteResponse;
            try {
                quoteResponse = await this.provider.quoteExactIn(request);
            }
            catch (error) {
                // A pool outside the four reviewed ones refuses in the decoder; only that refusal moves on to the next read.
                const pool = error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "jupiter_v1_pool_not_reviewed" ? error.details.pool : undefined;
                if (typeof pool !== "string")
                    throw error;
                returnedPools.push(pool);
                continue;
            }
            const pool = quoteResponse.routePlan[0].swapInfo.ammKey, route = admitted.find(row => row.pool === pool);
            if (route !== undefined) {
                selected = { route, quoteResponse, request };
                break;
            }
            returnedPools.push(pool);
        }
        if (selected === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter's best direct Whirlpool route uses a pool outside the admitted lane: the quote API takes no pool selector and returned a pool the active policy does not admit.", {
                reason: "jupiter_v1_provider_pool_not_admitted", provider: "jupiter", endpoint: "https://api.jup.ag/swap/v1/quote", network: `solana:${SOLANA_MAINNET_GENESIS}`,
                amountAtomic: input.amountAtomic, returnedPools: [...new Set(returnedPools)], admittedPools: admitted.map(route => route.pool)
            });
        const { route, quoteResponse, request } = selected, routeId = route.routeId;
        const build = await this.provider.buildExactIn(request, quoteResponse);
        routeConfigForQuoteBuild(quoteResponse, build, routeId);
        const execution = await this.resolver.resolve(payer, quoteResponse, build, jupiterV1MaximumNativeExpense(input.amountAtomic), undefined, routeId, this.options.freezeRpcLifetime === true);
        assertJupiterV1FreshMaterial(execution);
        const produced = await this.options.proveQuote(execution, input);
        const quote = snapshotFromJupiterV1QuoteProof(produced, execution, { profile: input.profile, account: input.account, recipient: input.recipient, amountAtomic: input.amountAtomic, slippageBps: input.slippageBps, now: input.now });
        const material = { quote, approvalCapAtomic: "0", gasOrEnergy: jupiterV1GasDisplay(execution), execution };
        validateJupiterV1PreparedMaterial(material);
        await this.store.save(material);
        return { quoteHash: quote.quoteHash, quote, fees: material.gasOrEnergy, mechanism: "jupiter_v1_direct_whirlpool", provenance: "upgrade_authority", signed: false, broadcast: false };
    }
    async load(hash) { return await this.store.load(hash); }
    /** The current routes the owner's policy admits for this input, in registry order; the single-route option names one. */
    async admittedRoutes(profile, amountAtomic) {
        const ids = this.options.resolveRouteIds !== undefined ? await this.options.resolveRouteIds(profile, amountAtomic)
            : [this.options.resolveRouteId === undefined ? JUPITER_V1_ROUTES[0].routeId : await this.options.resolveRouteId(profile, amountAtomic)];
        const routes = JUPITER_V1_ROUTES.filter(route => ids.includes(route.routeId));
        if (routes.length === 0)
            throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter V1 pool, variant or canonical route shape is outside the admitted lane.");
        return routes;
    }
}
//# sourceMappingURL=v1-builder.js.map