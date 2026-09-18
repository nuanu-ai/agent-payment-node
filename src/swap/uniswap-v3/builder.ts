import { getAddress } from "viem";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../../evm-rpc-codec.js";
import { parseAtomic } from "../../money.js";
import { swapMechanismDigest } from "../pin.js";
import { createSwapQuote } from "../quote.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import type { UniswapTransactionEnvelope } from "../uniswap-codec.js";
import { UNISWAP_CHAIN, UNISWAP_ROUTER } from "../uniswap-pin.js";
import { encodeUniswapV3ExactInput } from "./encoder.js";
import { readUniswapV3Quote } from "./onchain.js";
import { UNISWAP_V3_KEYLESS_MECHANISM_PIN, uniswapV3Pair, type UniswapV3PinVerifier } from "./pins.js";
import { SavedUniswapQuoteStore, UNISWAP_KEYLESS_EXECUTION_SCHEMA, uniswapEvidenceHash, uniswapGasDisplay,
  type UniswapKeylessEvidence, type UniswapKeylessMaterial } from "./material.js";

export interface UniswapKeylessQuoteRequest {
  readonly profile: string; readonly account: string; readonly recipient: string; readonly outputToken: string; readonly amountAtomic: string;
  readonly slippageBps: number; readonly ownerSlippageCapBps: number; readonly deadline: number;
  readonly maxGasLimit: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string;
}
const MAX_HEAD_DRIFT = 64, GAS_MARGIN_NUMERATOR = 5n, GAS_MARGIN_DENOMINATOR = 4n;

/**
 * Keyless read-only builder: price, output, slippage floor and impact come from the pinned pool and QuoterV2 by eth_call;
 * the Universal Router calldata is encoded locally and simulated at the same block. No API key or off-chain quote is used.
 */
export class KeylessUniswapQuoteBuilder implements GuardedSwapReadOnlyBuilder<UniswapKeylessQuoteRequest> {
  constructor(private readonly call: EvmRpcCall, private readonly quotes: SavedUniswapQuoteStore,
    private readonly verifyPins: UniswapV3PinVerifier) {}

  async quote(input: UniswapKeylessQuoteRequest & { readonly now: Date }): Promise<unknown> {
    const request = validateRequest(input), now = Math.floor(input.now.getTime() / 1000);
    if (request.deadline <= now || request.deadline - now > 1_800) invalid("Uniswap quote deadline must be in the next 30 minutes.");
    await this.assertChain();
    const block = await evmRpcBlock(this.call, "latest"), baseFee = evmRpcQuantity(block.raw.baseFeePerGas);
    const codePins = await this.verifyPins(this.call, block.tag), pair = request.pair;
    const pool = await readUniswapV3Quote(this.call, pair, request.amount, block.tag);
    if (pool.priceImpactBps > request.ownerSlippageCapBps) blocked("Pool price impact exceeds the owner slippage cap.", "uniswap_price_impact");
    const expected = BigInt(pool.amountOutAtomic), minimum = (expected * BigInt(10_000 - request.slippageBps) + 9_999n) / 10_000n;
    if (minimum <= 0n) blocked("Uniswap output floor is zero.", "uniswap_output_floor");
    const encoded = encodeUniswapV3ExactInput({ recipient: request.recipient, inputAmountAtomic: request.amount.toString(),
      minimumOutputAtomic: minimum.toString(), deadline: request.deadline, pair });
    const tx = { from: request.account, to: UNISWAP_ROUTER, data: encoded.data, value: `0x${request.amount.toString(16)}` };
    let callResult: `0x${string}`, gasEstimate: bigint;
    try { callResult = evmRpcHex(await this.call("eth_call", [tx, block.tag]));
      gasEstimate = evmRpcQuantity(await this.call("eth_estimateGas", [tx, block.tag])); }
    catch { return blocked("Exact Universal Router simulation reverted or was unavailable.", "uniswap_simulation"); }
    const gasLimit = (gasEstimate * GAS_MARGIN_NUMERATOR + GAS_MARGIN_DENOMINATOR - 1n) / GAS_MARGIN_DENOMINATOR;
    if (gasLimit > request.maxGasLimit) blocked("Simulated gas with margin exceeds the owner gas cap.", "uniswap_gas_cap");
    if (baseFee + request.maxPriorityFeePerGas > request.maxFeePerGas) blocked("Owner fee cap is below the current base fee plus priority fee.", "uniswap_fee_cap");
    const balance = evmRpcQuantity(await this.call("eth_getBalance", [request.account, block.tag]));
    if (balance < request.amount + gasLimit * request.maxFeePerGas) blocked("Account balance does not cover input plus the maximum network fee.", "uniswap_native_balance");
    await recheckEvmBlock(this.call, block);
    const head = await evmRpcBlock(this.call, "latest"), drift = BigInt(head.number) - BigInt(block.number);
    if (drift < 0n || drift > BigInt(MAX_HEAD_DRIFT)) blocked("Quote block is outside the allowed head drift.", "uniswap_head_drift");
    await this.assertChain();
    const envelope: UniswapTransactionEnvelope = { from: request.account, to: UNISWAP_ROUTER, data: encoded.data,
      value: request.amount.toString(), gasLimit: gasLimit.toString(), chainId: 1, maxFeePerGas: request.maxFeePerGas.toString(),
      maxPriorityFeePerGas: request.maxPriorityFeePerGas.toString() };
    const evidence: UniswapKeylessEvidence = { chainId: 1, blockNumber: block.number, blockHash: block.hash, baseFeePerGas: baseFee.toString(),
      accountBalanceWei: balance.toString(), codePins, pool };
    const simulationRequest = { chainId: 1, blockNumber: block.number, blockHash: block.hash, transaction: tx };
    const simulationResult = { callResult, gasEstimate: gasEstimate.toString(), blockNumber: block.number, blockHash: block.hash, headBlockNumber: head.number };
    const quote = createSwapQuote({ profile: request.profile, account: request.account, recipient: request.recipient,
      sourceAsset: { chain: UNISWAP_CHAIN, kind: "native", identifier: null },
      destinationAsset: { chain: UNISWAP_CHAIN, kind: "token", identifier: pair.outputToken },
      inputAmountAtomic: request.amount.toString(), expectedOutputAtomic: expected.toString(), minimumOutputAtomic: minimum.toString(),
      slippageBps: request.slippageBps, effectiveAt: input.now.toISOString(), expiresAt: new Date(request.deadline * 1000).toISOString(),
      providerResponseHash: uniswapEvidenceHash(evidence), routeHash: encoded.route.routeHash,
      unsignedTransactionPayloadHash: sha256(canonicalJson(envelope)),
      simulation: { requestHash: domainHash("apn.uniswap-simulation-request.v1", canonicalJson(simulationRequest)),
        resultHash: domainHash("apn.uniswap-simulation-result.v1", canonicalJson(simulationResult)), success: true,
        blockNumber: block.number, blockHash: block.hash, headBlockNumber: head.number, maxHeadDrift: MAX_HEAD_DRIFT,
        gasEstimate: gasEstimate.toString() } });
    const material: UniswapKeylessMaterial = { quote, approvalCapAtomic: "0", gasOrEnergy: uniswapGasDisplay(envelope),
      execution: { schemaVersion: UNISWAP_KEYLESS_EXECUTION_SCHEMA, envelope, deadline: request.deadline, evidence } };
    await this.quotes.save(material);
    return { quoteHash: quote.quoteHash, quote, unsignedTransaction: envelope, approvalCapAtomic: "0", gas: material.gasOrEnergy,
      price: { source: "uniswap_v3_quoter_v2_and_pool_slot0", pool: pool.pool, feeTier: pool.fee, block: block.number,
        blockHash: block.hash, sqrtPriceX96: pool.sqrtPriceX96, spotOutputPerEthAtomic: pool.spotOutputPerEthAtomic,
        expectedOutputAtomic: expected.toString(), minimumOutputAtomic: minimum.toString(), slippageBps: request.slippageBps,
        priceImpactBps: pool.priceImpactBps, outputSymbol: pair.outputSymbol, outputDecimals: pair.outputDecimals },
      mechanism: { pin: UNISWAP_V3_KEYLESS_MECHANISM_PIN, digest: swapMechanismDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN) },
      codePins: codePins.map((pin) => ({ role: pin.role, address: pin.address, codeHash: pin.codeHash })), signed: false, broadcast: false };
  }

  async load(quoteHash: string): Promise<UniswapKeylessMaterial | null> { return await this.quotes.load(quoteHash); }

  private async assertChain(): Promise<void> {
    if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap requires exact Ethereum chain 1 RPC.");
  }
}

function validateRequest(input: UniswapKeylessQuoteRequest & { readonly now: Date }) {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) invalid("Uniswap quote time is invalid.");
  const account = canonical(input.account), recipient = canonical(input.recipient), pair = uniswapV3Pair(canonical(input.outputToken));
  if (!Number.isSafeInteger(input.slippageBps) || !Number.isSafeInteger(input.ownerSlippageCapBps) || input.slippageBps < 0 ||
      input.ownerSlippageCapBps < 0 || input.ownerSlippageCapBps > 10_000 || input.slippageBps > input.ownerSlippageCapBps ||
      input.slippageBps >= 10_000) invalid("Uniswap slippage exceeds the owner cap.");
  if (!Number.isSafeInteger(input.deadline)) invalid("Uniswap deadline is invalid.");
  const amount = uint(input.amountAtomic), maxGasLimit = uint(input.maxGasLimit), maxFeePerGas = uint(input.maxFeePerGas),
    maxPriorityFeePerGas = uint(input.maxPriorityFeePerGas, false);
  if (maxPriorityFeePerGas > maxFeePerGas || maxGasLimit > 30_000_000n) invalid("Uniswap gas or fee caps are inconsistent.");
  return { profile: input.profile, account, recipient, pair, amount, slippageBps: input.slippageBps, ownerSlippageCapBps: input.ownerSlippageCapBps,
    deadline: input.deadline, maxGasLimit, maxFeePerGas, maxPriorityFeePerGas };
}
function canonical(value: string): string {
  try { const result = getAddress(value); if (result !== value || /^0x0{40}$/u.test(result)) throw new Error(); return result; }
  catch { return invalid("Uniswap address is invalid or non-canonical."); }
}
function uint(value: string, positive = true): bigint {
  try { if (typeof value !== "string" || value.length > 78) throw new Error(); return parseAtomic(value, { positive }); }
  catch { return invalid("Uniswap integer is invalid."); }
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
