import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SOLANA_APPROVAL_WINDOW_MS } from "../../rail-send-binding.js";
import { assertSolanaNetwork, protocolFailure, rpcAtomic, rpcRecord, solanaAddress, type SolanaRpcPort } from "../../solana/rpc.js";
import { swapMechanismDigest } from "../pin.js";
import { createSwapQuote } from "../quote.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { compileOrcaSwap, ORCA_MAX_COMPUTE_UNITS, type OrcaSwapLifetime, type OrcaSwapPlan } from "./instructions.js";
import { blockhashHex, ORCA_KEYLESS_EXECUTION_SCHEMA, ORCA_MAX_SLOT_DRIFT, orcaEvidenceHash, orcaGasDisplay, orcaRouteHash,
  priorityFeeLamports, SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE, type OrcaKeylessMaterial, type OrcaQuoteEvidence, type SavedOrcaQuoteStore } from "./material.js";
import { ORCA_KEYLESS_MECHANISM_PIN, ORCA_POOL_FEE_RATE, ORCA_SOL_USDC_POOL, ORCA_SOLANA_CHAIN, USDC_MINT, WHIRLPOOL_PROGRAM,
  type OrcaProgramPinVerifier } from "./pins.js";
import { readOrcaMarket } from "./market.js";
import { simulateOrcaSwap } from "./simulation.js";

export interface OrcaKeylessQuoteRequest {
  readonly profile: string; readonly account: string; readonly amountAtomic: string;
  readonly slippageBps: number; readonly ownerSlippageCapBps: number;
  readonly computeUnitLimit: number; readonly computeUnitPriceMicroLamports: string;
}
const U64_MAX = (1n << 64n) - 1n;

/**
 * Keyless read-only builder: price, expected output, slippage floor and impact come from the pinned Whirlpool, its
 * vaults and tick arrays at one slot; the instruction list is built locally, validated, fee-priced by the chain and
 * simulated with `sigVerify: false`. No API key, route API or off-chain quote is used. Nothing is signed.
 */
export class KeylessOrcaQuoteBuilder implements GuardedSwapReadOnlyBuilder<OrcaKeylessQuoteRequest> {
  constructor(private readonly rpc: SolanaRpcPort, private readonly quotes: SavedOrcaQuoteStore, private readonly verifyPins: OrcaProgramPinVerifier) {}

  async quote(input: OrcaKeylessQuoteRequest & { readonly now: Date }): Promise<unknown> {
    const request = validateRequest(input);
    await assertSolanaNetwork(this.rpc);
    const pins = await this.verifyPins(this.rpc);
    const market = await readOrcaMarket(this.rpc, request.account, request.amount);
    const swap = market.swap;
    if (swap.priceImpactBps > request.ownerSlippageCapBps) blocked("Pool price impact exceeds the owner slippage cap.", "orca_price_impact");
    const expected = BigInt(swap.amountOutAtomic), minimum = (expected * BigInt(10_000 - request.slippageBps) + 9_999n) / 10_000n;
    if (minimum <= 0n) blocked("Orca output floor is zero.", "orca_output_floor");
    const plan: OrcaSwapPlan = { owner: request.account, wsolAccount: market.wsolAccount, usdcAccount: market.usdcAccount,
      amountInLamports: request.amount.toString(), minimumOutputAtomic: minimum.toString(), computeUnitLimit: request.computeUnitLimit,
      computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports, tickArrays: market.tickArrays.map((row) => row.address),
      oracle: market.oracle };
    const lifetime = await latestLifetime(this.rpc), compiled = compileOrcaSwap(plan, lifetime);
    const fee = await orcaMessageFee(this.rpc, compiled.messageBase64);
    if (fee < SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE + priorityFeeLamports(plan)) protocolFailure();
    const rent = market.owner.usdcAccountExists ? 0n : market.tokenAccountRentLamports, maximumSpend = request.amount + fee + rent;
    requireOrcaFunds(market.owner.ownerLamports, maximumSpend + market.tokenAccountRentLamports);
    const simulation = await simulateOrcaSwap(this.rpc, compiled.unsignedPayload, { owner: plan.owner, wsolAccount: plan.wsolAccount,
      usdcAccount: plan.usdcAccount, before: market.owner, minimumOutputAtomic: plan.minimumOutputAtomic,
      maximumSolSpendLamports: maximumSpend.toString(), computeUnitLimit: plan.computeUnitLimit }, true, market.slot.toString());
    if (BigInt(simulation.slot) - market.slot > BigInt(ORCA_MAX_SLOT_DRIFT)) blocked("Simulation slot is outside the allowed drift.", "orca_slot_drift");
    const evidence: OrcaQuoteEvidence = { slot: market.slot.toString(), pool: market.poolView, accountDataSha256: market.accountDataSha256,
      tickArrayStarts: market.tickArrays.map((row) => row.startTickIndex), vaultSolLamports: market.vaultSolLamports,
      vaultUsdcAtomic: market.vaultUsdcAtomic, owner: market.owner, tokenAccountRentLamports: market.tokenAccountRentLamports.toString(),
      programPins: pins.map((pin) => ({ role: pin.role, address: pin.address, dataSha256: pin.dataSha256 })), swap };
    const quote = createSwapQuote({ profile: request.profile, account: request.account, recipient: request.account,
      sourceAsset: { chain: ORCA_SOLANA_CHAIN, kind: "native", identifier: null },
      destinationAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: USDC_MINT },
      inputAmountAtomic: request.amount.toString(), expectedOutputAtomic: expected.toString(), minimumOutputAtomic: minimum.toString(),
      slippageBps: request.slippageBps, effectiveAt: input.now.toISOString(),
      expiresAt: new Date(input.now.getTime() + SOLANA_APPROVAL_WINDOW_MS).toISOString(),
      providerResponseHash: orcaEvidenceHash(evidence), routeHash: orcaRouteHash(plan), unsignedTransactionPayloadHash: sha256(compiled.unsignedPayload),
      simulation: { requestHash: simulation.requestHash, resultHash: simulation.resultHash, success: true, blockNumber: market.slot.toString(),
        blockHash: blockhashHex(lifetime.blockhash), headBlockNumber: simulation.slot, maxHeadDrift: ORCA_MAX_SLOT_DRIFT,
        gasEstimate: simulation.unitsConsumed } });
    const execution = { schemaVersion: ORCA_KEYLESS_EXECUTION_SCHEMA, plan, lifetime, unsignedPayload: compiled.unsignedPayload,
      messageHash: compiled.messageHash, networkFeeLamports: fee.toString(), usdcAccountRentLamports: rent.toString(),
      maximumSolSpendLamports: maximumSpend.toString(), ownerSlippageCapBps: request.ownerSlippageCapBps, evidence, simulation } as const;
    const material: OrcaKeylessMaterial = { quote, approvalCapAtomic: "0", gasOrEnergy: orcaGasDisplay(execution), execution };
    await this.quotes.save(material);
    return { quoteHash: quote.quoteHash, quote, unsignedTransaction: { payloadBase64: compiled.unsignedPayload, messageHash: compiled.messageHash,
      lifetime, instructions: ["compute_budget.set_compute_unit_limit", "compute_budget.set_compute_unit_price",
        "associated_token.create_idempotent(wSOL)", "associated_token.create_idempotent(USDC)", "system.transfer(wrap input)",
        "token.sync_native", "whirlpool.swap(exact_in, a_to_b)", "token.close_account(wSOL to owner)"] },
      approvalCapAtomic: "0", fees: material.gasOrEnergy,
      price: { source: "orca_whirlpool_onchain_state", pool: ORCA_SOL_USDC_POOL, program: WHIRLPOOL_PROGRAM, feeRate: ORCA_POOL_FEE_RATE,
        slot: market.slot.toString(), sqrtPrice: swap.sqrtPriceBefore, tickCurrentIndex: swap.tickBefore,
        spotUsdcPerSolAtomic: swap.spotOutputPerSolAtomic, expectedOutputAtomic: expected.toString(), minimumOutputAtomic: minimum.toString(),
        slippageBps: request.slippageBps, priceImpactBps: swap.priceImpactBps, initializedTicksCrossed: swap.initializedTicksCrossed },
      simulation: { slot: simulation.slot, unitsConsumed: simulation.unitsConsumed, usdcReceivedAtomic: simulation.usdcReceivedAtomic,
        solSpentLamports: simulation.solSpentLamports, sigVerify: false, replaceRecentBlockhash: true },
      mechanism: { pin: ORCA_KEYLESS_MECHANISM_PIN, digest: swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN) },
      programPins: evidence.programPins, signed: false, broadcast: false };
  }

  async load(quoteHash: string): Promise<OrcaKeylessMaterial | null> { return await this.quotes.load(quoteHash); }
}

export async function latestLifetime(rpc: SolanaRpcPort): Promise<OrcaSwapLifetime> {
  const block = rpcRecord(rpcRecord(await rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }])).value);
  if (typeof block.blockhash !== "string") protocolFailure();
  return { blockhash: solanaAddress(block.blockhash), lastValidBlockHeight: rpcAtomic(block.lastValidBlockHeight).toString() };
}
export async function orcaMessageFee(rpc: SolanaRpcPort, messageBase64: string): Promise<bigint> {
  const value = rpcRecord(await rpc.call("getFeeForMessage", [messageBase64, { commitment: "confirmed" }])).value;
  if (value === null) throw new ApnError("APN_REPREPARE_REQUIRED", "The Solana blockhash expired before the fee could be priced.");
  const fee = rpcAtomic(value); if (fee === 0n) protocolFailure(); return fee;
}
/** An insufficient balance is an economic refusal: input, fee, USDC account rent and the transient wSOL rent. */
export function requireOrcaFunds(ownerLamports: string, required: bigint): void {
  if (BigInt(ownerLamports) < required) {
    throw new ApnError("APN_INSUFFICIENT_ASSET", "The SOL balance cannot cover the input, network fee and account rent.", { reason: "orca_insufficient_sol" });
  }
}

function validateRequest(input: OrcaKeylessQuoteRequest & { readonly now: Date }) {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) invalid("Orca quote time is invalid.");
  const account = solanaAddress(input.account);
  if (!Number.isSafeInteger(input.slippageBps) || !Number.isSafeInteger(input.ownerSlippageCapBps) || input.slippageBps < 0 ||
      input.ownerSlippageCapBps < 0 || input.ownerSlippageCapBps > 10_000 || input.slippageBps > input.ownerSlippageCapBps ||
      input.slippageBps >= 10_000) invalid("Orca slippage exceeds the owner cap.");
  if (typeof input.amountAtomic !== "string" || !/^[1-9][0-9]{0,19}$/u.test(input.amountAtomic) || BigInt(input.amountAtomic) > U64_MAX) {
    invalid("Orca input must be a positive u64 lamport amount.");
  }
  if (!Number.isSafeInteger(input.computeUnitLimit) || input.computeUnitLimit < 1 || input.computeUnitLimit > ORCA_MAX_COMPUTE_UNITS ||
      typeof input.computeUnitPriceMicroLamports !== "string" || !/^(?:0|[1-9][0-9]{0,15})$/u.test(input.computeUnitPriceMicroLamports)) {
    invalid("Orca compute unit caps are invalid.");
  }
  return { profile: input.profile, account, amount: BigInt(input.amountAtomic), slippageBps: input.slippageBps,
    ownerSlippageCapBps: input.ownerSlippageCapBps, computeUnitLimit: input.computeUnitLimit,
    computeUnitPriceMicroLamports: input.computeUnitPriceMicroLamports };
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
