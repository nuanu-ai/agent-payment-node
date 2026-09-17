import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { AssetPolicyRegistry } from "../asset-policy-registry.js";
import { GuardedSwapService } from "./service.js";
import type { SwapOperationRecord } from "./model.js";
import type { SwapProtocolRegistry } from "./protocol-registry.js";
import type { SwapQuoteInput } from "./quote.js";
import { createUniswapQuoteRequest, createUniswapSwapRequest, decodeUniswapQuoteResponse, decodeUniswapSwapResponse,
  uniswapRawDigest, type UniswapSwapResponse } from "./uniswap-codec.js";
import { UniswapTradingApi } from "./uniswap-http.js";
import { UNISWAP_CHAIN, UNISWAP_OFFICIAL_PIN_CATALOG, UNISWAP_USDC } from "./uniswap-pin.js";
import { decodeUniswapRouterCalldata } from "./uniswap-router.js";
import { UniswapEvmSimulator } from "./uniswap-simulation.js";

export interface UniswapQuoteInput { readonly profile: string; readonly account: string; readonly recipient: string;
  readonly amountAtomic: string; readonly slippageBps: number; readonly ownerSlippageCapBps: number; readonly deadline: number;
  readonly maxGasLimit: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly now: Date }
export interface UniswapGuardedQuote { readonly quote: SwapQuoteInput; readonly envelope: UniswapSwapResponse["swap"];
  readonly deadline: number; readonly providerQuote: unknown; readonly providerRequestHash: string }

export class UniswapGuardedSwapBuilder {
  constructor(private readonly api: Pick<UniswapTradingApi, "quote" | "swap">,
    private readonly simulator: Pick<UniswapEvmSimulator, "simulate">) {}
  inventory() { return { catalog: UNISWAP_OFFICIAL_PIN_CATALOG, admitted: false,
    note: "Official catalog presence does not admit either asset or authorize execution." }; }
  async quote(input: UniswapQuoteInput): Promise<UniswapGuardedQuote> {
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) || !Number.isSafeInteger(input.deadline) ||
        input.deadline <= Math.floor(input.now.getTime() / 1000) || input.deadline - Math.floor(input.now.getTime() / 1000) > 1_800) {
      throw new ApnError("APN_INVALID_INPUT", "Uniswap quote deadline must be in the next 30 minutes.");
    }
    const request = createUniswapQuoteRequest({ amountAtomic: input.amountAtomic, swapper: input.account, recipient: input.recipient,
      slippageBps: input.slippageBps, ownerSlippageCapBps: input.ownerSlippageCapBps });
    const rawQuote = await this.api.quote(request), quoteResponse = decodeUniswapQuoteResponse(rawQuote, request);
    const expectedOutput = BigInt(quoteResponse.quote.output.amount), numerator = expectedOutput * BigInt(10_000 - input.slippageBps);
    const minimumOutput = (numerator + 9_999n) / 10_000n;
    if (minimumOutput <= 0n) throw new ApnError("APN_PROVIDER_PROTOCOL", "Uniswap output floor is zero.");
    const swapRequest = createUniswapSwapRequest(quoteResponse.quote, input.deadline), rawSwap = await this.api.swap(swapRequest);
    const swap = decodeUniswapSwapResponse(rawSwap, { account: input.account, amountAtomic: input.amountAtomic,
      maxGasLimit: input.maxGasLimit, maxFeePerGas: input.maxFeePerGas, maxPriorityFeePerGas: input.maxPriorityFeePerGas });
    const route = decodeUniswapRouterCalldata(swap.swap.data, { recipient: input.recipient, inputAmountAtomic: input.amountAtomic,
      minimumOutputAtomic: minimumOutput.toString(), deadline: input.deadline });
    const simulation = await this.simulator.simulate(swap.swap);
    if (BigInt(simulation.gasEstimate) > BigInt(swap.swap.gasLimit)) throw new ApnError("APN_OPERATION_BLOCKED", "Exact estimateGas exceeds the unsigned envelope gas limit.", { reason: "uniswap_gas_drift" });
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
  async prepare(input: UniswapQuoteInput & { readonly assetPolicy: AssetPolicyRegistry; readonly protocolRegistry: SwapProtocolRegistry;
    readonly idempotencyKey: string }, core: GuardedSwapService): Promise<{ readonly operation: SwapOperationRecord; readonly quote: UniswapGuardedQuote }> {
    const built = await this.quote(input), operation = await core.prepare({ quote: built.quote, assetPolicy: input.assetPolicy,
      protocolRegistry: input.protocolRegistry, idempotencyKey: input.idempotencyKey, approvalCapAtomic: "0", now: input.now });
    return { operation, quote: built };
  }
  refuseTokenApproval(): never { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
    "ERC20 and Permit2 swap approval is a separate dormant path; native ETH requires no approval.", { reason: "uniswap_erc20_approval_dormant" }); }
  refuseExecution(): never { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
    "Uniswap execution is dormant until an exact signer, single-send adapter, and receipt observer are installed.", { reason: "uniswap_execution_dormant" }); }
}
