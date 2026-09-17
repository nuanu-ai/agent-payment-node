import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { GuardedSwapService } from "./service.js";
import { createUniswapQuoteRequest, createUniswapSwapRequest, decodeUniswapQuoteResponse, decodeUniswapSwapResponse, uniswapRawDigest } from "./uniswap-codec.js";
import { UniswapTradingApi } from "./uniswap-http.js";
import { UNISWAP_CHAIN, UNISWAP_OFFICIAL_PIN_CATALOG, UNISWAP_USDC } from "./uniswap-pin.js";
import { decodeUniswapRouterCalldata } from "./uniswap-router.js";
import { UniswapEvmSimulator } from "./uniswap-simulation.js";
export class UniswapGuardedSwapBuilder {
    api;
    simulator;
    constructor(api, simulator) {
        this.api = api;
        this.simulator = simulator;
    }
    inventory() {
        return { catalog: UNISWAP_OFFICIAL_PIN_CATALOG, admitted: false,
            note: "Official catalog presence does not admit either asset or authorize execution." };
    }
    async quote(input) {
        if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) || !Number.isSafeInteger(input.deadline) ||
            input.deadline <= Math.floor(input.now.getTime() / 1000) || input.deadline - Math.floor(input.now.getTime() / 1000) > 1_800) {
            throw new ApnError("APN_INVALID_INPUT", "Uniswap quote deadline must be in the next 30 minutes.");
        }
        const request = createUniswapQuoteRequest({ ...input, swapper: input.account }), rawQuote = await this.api.quote(request), quoteResponse = decodeUniswapQuoteResponse(rawQuote, request);
        const expectedOutput = BigInt(quoteResponse.quote.output.amount), minimumOutput = expectedOutput * BigInt(10_000 - input.slippageBps) / 10000n;
        if (minimumOutput <= 0n)
            throw new ApnError("APN_PROVIDER_PROTOCOL", "Uniswap output floor is zero.");
        const swapRequest = createUniswapSwapRequest(quoteResponse.quote, input.deadline), rawSwap = await this.api.swap(swapRequest);
        const swap = decodeUniswapSwapResponse(rawSwap, { account: input.account, amountAtomic: input.amountAtomic,
            maxGasLimit: input.maxGasLimit, maxFeePerGas: input.maxFeePerGas, maxPriorityFeePerGas: input.maxPriorityFeePerGas });
        const route = decodeUniswapRouterCalldata(swap.swap.data, { recipient: input.recipient, inputAmountAtomic: input.amountAtomic,
            minimumOutputAtomic: minimumOutput.toString(), deadline: input.deadline });
        const simulation = await this.simulator.simulate(swap.swap);
        if (BigInt(simulation.gasEstimate) > BigInt(swap.swap.gasLimit))
            throw new ApnError("APN_OPERATION_BLOCKED", "Exact estimateGas exceeds the unsigned envelope gas limit.", { reason: "uniswap_gas_drift" });
        const effectiveAt = input.now.toISOString(), expiresAt = new Date(input.deadline * 1000).toISOString();
        return { quote: { profile: input.profile, account: input.account, recipient: input.recipient,
                sourceAsset: { chain: UNISWAP_CHAIN, kind: "native", identifier: null },
                destinationAsset: { chain: UNISWAP_CHAIN, kind: "token", identifier: UNISWAP_USDC },
                inputAmountAtomic: input.amountAtomic, expectedOutputAtomic: expectedOutput.toString(), minimumOutputAtomic: minimumOutput.toString(),
                slippageBps: input.slippageBps, effectiveAt, expiresAt, providerResponseHash: uniswapRawDigest(rawSwap),
                routeHash: route.routeHash, unsignedTransactionPayloadHash: sha256(canonicalJson(swap.swap)), simulation },
            envelope: swap.swap, deadline: input.deadline, providerQuote: quoteResponse.quote,
            providerRequestHash: sha256(canonicalJson({ quote: request, swap: swapRequest })) };
    }
    async prepare(input, core) {
        const built = await this.quote(input), operation = await core.prepare({ quote: built.quote, assetPolicy: input.assetPolicy,
            protocolRegistry: input.protocolRegistry, idempotencyKey: input.idempotencyKey, approvalCapAtomic: "0", now: input.now });
        return { operation, quote: built };
    }
    refuseTokenApproval() {
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "ERC20 and Permit2 swap approval is a separate dormant path; native ETH requires no approval.", { reason: "uniswap_erc20_approval_dormant" });
    }
    refuseExecution() {
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap execution is dormant until an exact signer, single-send adapter, and receipt observer are installed.", { reason: "uniswap_execution_dormant" });
    }
}
//# sourceMappingURL=uniswap-service.js.map