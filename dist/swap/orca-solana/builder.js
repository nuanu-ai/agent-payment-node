import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SOLANA_APPROVAL_WINDOW_MS } from "../../rail-send-binding.js";
import { assertSolanaNetwork, protocolFailure, rpcAtomic, rpcRecord, solanaAddress } from "../../solana/rpc.js";
import { swapMechanismDigest } from "../pin.js";
import { createSwapQuote } from "../quote.js";
import { compileOrcaSwap, isOrcaTokenPlan, ORCA_MAX_COMPUTE_UNITS } from "./instructions.js";
import { spotOutput } from "./math.js";
import { blockhashHex, ORCA_KEYLESS_EXECUTION_SCHEMA, ORCA_MAX_SLOT_DRIFT, ORCA_TOKEN_EXECUTION_SCHEMA, orcaEvidenceHash, orcaGasDisplay, orcaRouteHash, orcaTokenGasDisplay, priorityFeeLamports, SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE } from "./material.js";
import { ORCA_SOLANA_CHAIN, WHIRLPOOL_PROGRAM } from "./pins.js";
import { readOrcaMarket, readOrcaTokenMarket } from "./market.js";
import { simulateOrcaSwap, simulateOrcaTokenSwap } from "./simulation.js";
const U64_MAX = (1n << 64n) - 1n;
/**
 * Keyless read-only builder for one pinned pool: price, expected output, slippage floor and impact come from the pinned
 * Whirlpool, its vaults and tick arrays at one slot; the instruction list is built locally, validated, fee-priced by the
 * chain and simulated with `sigVerify: false`. No API key, route API or off-chain quote is used. Nothing is signed.
 */
export class KeylessOrcaQuoteBuilder {
    rpc;
    quotes;
    verifyPins;
    pool;
    constructor(rpc, quotes, verifyPins, pool) {
        this.rpc = rpc;
        this.quotes = quotes;
        this.verifyPins = verifyPins;
        this.pool = pool;
    }
    async quote(input) {
        const request = validateRequest(input);
        await assertSolanaNetwork(this.rpc);
        const pins = await this.verifyPins(this.rpc);
        return this.pool.nativeWrap === "a" ? await this.quoteNative(request, input.now, pins) : await this.quoteToken(request, input.now, pins);
    }
    /** A saved quote of another pool never enters this pool's runtime. */
    async load(quoteHash) {
        const material = await this.quotes.load(quoteHash);
        if (material !== null && (isOrcaTokenPlan(material.execution.plan) ? material.execution.plan.pool : "sol-usdc") !== this.pool.id) {
            throw new ApnError("APN_OPERATION_BLOCKED", "The saved Orca quote belongs to another pool.", { reason: "orca_pool_mismatch" });
        }
        return material;
    }
    async quoteNative(request, now, pins) {
        const market = await readOrcaMarket(this.rpc, request.account, request.amount), minimum = floor(market.swap, request);
        const plan = { owner: request.account, wsolAccount: market.wsolAccount, usdcAccount: market.usdcAccount,
            amountInLamports: request.amount.toString(), minimumOutputAtomic: minimum.toString(), computeUnitLimit: request.computeUnitLimit,
            computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports, tickArrays: market.tickArrays.map((row) => row.address),
            oracle: market.oracle, ...(market.wsol === null ? {} : { wsolAccountKept: true }) };
        const { lifetime, compiled, fee } = await this.priced(plan);
        const rent = market.owner.usdcAccountExists ? 0n : market.tokenAccountRentLamports, maximumSpend = request.amount + fee + rent;
        requireOrcaFunds(market.owner.ownerLamports, maximumSpend + (market.wsol === null ? market.tokenAccountRentLamports : 0n));
        const simulation = await simulateOrcaSwap(this.rpc, compiled.unsignedPayload, { owner: plan.owner, wsolAccount: plan.wsolAccount,
            usdcAccount: plan.usdcAccount, before: market.owner, minimumOutputAtomic: plan.minimumOutputAtomic,
            maximumSolSpendLamports: maximumSpend.toString(), computeUnitLimit: plan.computeUnitLimit, wsolKept: market.wsol }, true, market.slot.toString());
        driftBound(simulation, market.slot);
        const evidence = { slot: market.slot.toString(), pool: market.poolView, accountDataSha256: market.accountDataSha256,
            tickArrayStarts: market.tickArrays.map((row) => row.startTickIndex), vaultSolLamports: market.vaultSolLamports,
            vaultUsdcAtomic: market.vaultUsdcAtomic, owner: market.owner, tokenAccountRentLamports: market.tokenAccountRentLamports.toString(),
            programPins: pins, swap: market.swap };
        const execution = { schemaVersion: ORCA_KEYLESS_EXECUTION_SCHEMA, plan, lifetime, unsignedPayload: compiled.unsignedPayload,
            messageHash: compiled.messageHash, networkFeeLamports: fee.toString(), usdcAccountRentLamports: rent.toString(),
            maximumSolSpendLamports: maximumSpend.toString(), ownerSlippageCapBps: request.ownerSlippageCapBps, evidence, simulation };
        return await this.saved({ request, now, sourceAsset: { kind: "native", identifier: null }, compiled, minimum, execution,
            gasOrEnergy: orcaGasDisplay(execution), poolView: market.poolView, swap: market.swap, steps: ["associated_token.create_idempotent(wSOL)",
                "associated_token.create_idempotent(USDC)", "system.transfer(wrap input)", "token.sync_native", "whirlpool.swap(exact_in, a_to_b)",
                "token.close_account(wSOL to owner)"] });
    }
    async quoteToken(request, now, pins) {
        const pool = this.pool, market = await readOrcaTokenMarket(this.rpc, pool, request.account, request.amount), minimum = floor(market.swap, request);
        const plan = { pool: pool.id, owner: request.account, sourceAccount: market.sourceAccount,
            destinationAccount: market.destinationAccount, amountInAtomic: request.amount.toString(), minimumOutputAtomic: minimum.toString(),
            computeUnitLimit: request.computeUnitLimit, computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports,
            tickArrays: market.tickArrays.map((row) => row.address), oracle: market.oracle };
        const { lifetime, compiled, fee } = await this.priced(plan);
        const rent = market.owner.destinationAccountExists ? 0n : market.tokenAccountRentLamports, maximumSpend = fee + rent;
        requireOrcaFunds(market.owner.ownerLamports, maximumSpend);
        const simulation = await simulateOrcaTokenSwap(this.rpc, compiled.unsignedPayload, { pool, owner: plan.owner, sourceAccount: plan.sourceAccount,
            destinationAccount: plan.destinationAccount, before: market.owner, amountInAtomic: plan.amountInAtomic, minimumOutputAtomic: plan.minimumOutputAtomic,
            maximumSolSpendLamports: maximumSpend.toString(), computeUnitLimit: plan.computeUnitLimit }, true, market.slot.toString());
        driftBound(simulation, market.slot);
        const evidence = { slot: market.slot.toString(), pool: market.poolView, accountDataSha256: market.accountDataSha256,
            tickArrayStarts: market.tickArrays.map((row) => row.startTickIndex), vaultAAtomic: market.vaultAAtomic, vaultBAtomic: market.vaultBAtomic,
            owner: market.owner, tokenAccountRentLamports: market.tokenAccountRentLamports.toString(), programPins: pins, swap: market.swap };
        const execution = { schemaVersion: ORCA_TOKEN_EXECUTION_SCHEMA, plan, lifetime, unsignedPayload: compiled.unsignedPayload,
            messageHash: compiled.messageHash, networkFeeLamports: fee.toString(), destinationAccountRentLamports: rent.toString(),
            maximumSolSpendLamports: maximumSpend.toString(), ownerSlippageCapBps: request.ownerSlippageCapBps, evidence, simulation };
        return await this.saved({ request, now, sourceAsset: { kind: "token", identifier: pool.mintA }, compiled, minimum, execution,
            gasOrEnergy: orcaTokenGasDisplay(execution), poolView: market.poolView, swap: market.swap,
            steps: [`associated_token.create_idempotent(${pool.symbolB})`, "whirlpool.swap(exact_in, a_to_b)"] });
    }
    async priced(plan) {
        const lifetime = await latestLifetime(this.rpc), compiled = compileOrcaSwap(plan, lifetime);
        const fee = await orcaMessageFee(this.rpc, compiled.messageBase64);
        if (fee < SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE + priorityFeeLamports(plan))
            protocolFailure();
        return { lifetime, compiled, fee };
    }
    /** Binds the quote to the evidence, plan, bytes and simulation, saves the material, and returns the unsigned quote. */
    async saved(input) {
        const { request, now, compiled, minimum, execution, poolView, swap } = input, { plan, lifetime, evidence, simulation } = execution;
        const pool = this.pool, expected = swap.amountOutAtomic;
        const quote = createSwapQuote({ profile: request.profile, account: request.account, recipient: request.account,
            sourceAsset: { ...input.sourceAsset, chain: ORCA_SOLANA_CHAIN }, destinationAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: pool.mintB },
            inputAmountAtomic: request.amount.toString(), expectedOutputAtomic: expected, minimumOutputAtomic: minimum.toString(),
            slippageBps: request.slippageBps, effectiveAt: now.toISOString(), expiresAt: new Date(now.getTime() + SOLANA_APPROVAL_WINDOW_MS).toISOString(),
            providerResponseHash: orcaEvidenceHash(evidence), routeHash: orcaRouteHash(plan), unsignedTransactionPayloadHash: sha256(compiled.unsignedPayload),
            simulation: { requestHash: simulation.requestHash, resultHash: simulation.resultHash, success: true, blockNumber: evidence.slot,
                blockHash: blockhashHex(lifetime.blockhash), headBlockNumber: simulation.slot, maxHeadDrift: ORCA_MAX_SLOT_DRIFT,
                gasEstimate: simulation.unitsConsumed } });
        const material = { quote, approvalCapAtomic: "0", gasOrEnergy: input.gasOrEnergy, execution };
        await this.quotes.save(material);
        const unit = 10n ** BigInt(pool.decimalsA), received = "outputReceivedAtomic" in simulation ? simulation.outputReceivedAtomic : simulation.usdcReceivedAtomic;
        return { quoteHash: quote.quoteHash, pool: pool.id, quote, unsignedTransaction: { payloadBase64: compiled.unsignedPayload, messageHash: compiled.messageHash,
                lifetime, instructions: ["compute_budget.set_compute_unit_limit", "compute_budget.set_compute_unit_price", ...input.steps] },
            approvalCapAtomic: "0", fees: material.gasOrEnergy,
            price: { source: "orca_whirlpool_onchain_state", pool: pool.pool, program: WHIRLPOOL_PROGRAM, feeRate: poolView.feeRate,
                slot: evidence.slot, sqrtPrice: swap.sqrtPriceBefore, tickCurrentIndex: swap.tickBefore,
                ...(pool.nativeWrap === "a" ? { spotUsdcPerSolAtomic: swap.spotOutputPerSolAtomic }
                    : { spotOutputPerInputUnitAtomic: spotOutput(unit, BigInt(swap.sqrtPriceBefore)).toString() }),
                expectedOutputAtomic: expected, minimumOutputAtomic: minimum.toString(), slippageBps: request.slippageBps,
                priceImpactBps: swap.priceImpactBps, initializedTicksCrossed: swap.initializedTicksCrossed },
            simulation: { slot: simulation.slot, unitsConsumed: simulation.unitsConsumed,
                ...(pool.nativeWrap === "a" ? { usdcReceivedAtomic: received } : { outputReceivedAtomic: received }),
                solSpentLamports: simulation.solSpentLamports, sigVerify: false, replaceRecentBlockhash: true },
            mechanism: { pin: pool.mechanismPin, digest: swapMechanismDigest(pool.mechanismPin) },
            programPins: evidence.programPins, signed: false, broadcast: false };
    }
}
export async function latestLifetime(rpc) {
    const block = rpcRecord(rpcRecord(await rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }])).value);
    if (typeof block.blockhash !== "string")
        protocolFailure();
    return { blockhash: solanaAddress(block.blockhash), lastValidBlockHeight: rpcAtomic(block.lastValidBlockHeight).toString() };
}
export async function orcaMessageFee(rpc, messageBase64) {
    const value = rpcRecord(await rpc.call("getFeeForMessage", [messageBase64, { commitment: "confirmed" }])).value;
    if (value === null)
        throw new ApnError("APN_REPREPARE_REQUIRED", "The Solana blockhash expired before the fee could be priced.");
    const fee = rpcAtomic(value);
    if (fee === 0n)
        protocolFailure();
    return fee;
}
/** An insufficient balance is an economic refusal: the SOL the swap may spend (input for sol-usdc, fee, account rent). */
export function requireOrcaFunds(ownerLamports, required) {
    if (BigInt(ownerLamports) < required) {
        throw new ApnError("APN_INSUFFICIENT_ASSET", "The SOL balance cannot cover the input, network fee and account rent.", { reason: "orca_insufficient_sol" });
    }
}
function floor(swap, request) {
    if (swap.priceImpactBps > request.ownerSlippageCapBps)
        blocked("Pool price impact exceeds the owner slippage cap.", "orca_price_impact");
    const minimum = (BigInt(swap.amountOutAtomic) * BigInt(10_000 - request.slippageBps) + 9999n) / 10000n;
    if (minimum <= 0n)
        blocked("Orca output floor is zero.", "orca_output_floor");
    return minimum;
}
function driftBound(simulation, slot) {
    if (BigInt(simulation.slot) - slot > BigInt(ORCA_MAX_SLOT_DRIFT))
        blocked("Simulation slot is outside the allowed drift.", "orca_slot_drift");
}
function validateRequest(input) {
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
        invalid("Orca quote time is invalid.");
    const account = solanaAddress(input.account);
    if (!Number.isSafeInteger(input.slippageBps) || !Number.isSafeInteger(input.ownerSlippageCapBps) || input.slippageBps < 0 ||
        input.ownerSlippageCapBps < 0 || input.ownerSlippageCapBps > 10_000 || input.slippageBps > input.ownerSlippageCapBps ||
        input.slippageBps >= 10_000)
        invalid("Orca slippage exceeds the owner cap.");
    if (typeof input.amountAtomic !== "string" || !/^[1-9][0-9]{0,19}$/u.test(input.amountAtomic) || BigInt(input.amountAtomic) > U64_MAX) {
        invalid("Orca input must be a positive u64 atomic amount.");
    }
    if (!Number.isSafeInteger(input.computeUnitLimit) || input.computeUnitLimit < 1 || input.computeUnitLimit > ORCA_MAX_COMPUTE_UNITS ||
        typeof input.computeUnitPriceMicroLamports !== "string" || !/^(?:0|[1-9][0-9]{0,15})$/u.test(input.computeUnitPriceMicroLamports)) {
        invalid("Orca compute unit caps are invalid.");
    }
    return { profile: input.profile, account, amount: BigInt(input.amountAtomic), slippageBps: input.slippageBps,
        ownerSlippageCapBps: input.ownerSlippageCapBps, computeUnitLimit: input.computeUnitLimit,
        computeUnitPriceMicroLamports: input.computeUnitPriceMicroLamports };
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=builder.js.map