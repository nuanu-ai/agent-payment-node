import { getBase58Encoder } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapQuote } from "../quote.js";
import { compileOrcaSwap, isOrcaTokenPlan, orcaPlanSides } from "./instructions.js";
import { ORCA_SOL_USDC_POOL, ORCA_SOLANA_CHAIN, USDC_MINT } from "./pins.js";
export const ORCA_KEYLESS_EXECUTION_SCHEMA = "apn.orca-whirlpool-keyless-execution.v1";
export const ORCA_TOKEN_EXECUTION_SCHEMA = "apn.orca-whirlpool-keyless-token-execution.v1";
export const ORCA_EVIDENCE_DOMAIN = "apn.orca-whirlpool-onchain-evidence.v1";
export const ORCA_ROUTE_DOMAIN = "apn.orca-whirlpool-route.v1";
import { ORCA_MAX_SLOT_DRIFT } from "./accounts.js";
export { ORCA_MAX_SLOT_DRIFT };
export const SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE = 5000n;
export function orcaEvidenceHash(evidence) { return domainHash(ORCA_EVIDENCE_DOMAIN, canonicalJson(evidence)); }
export function orcaRouteHash(plan) {
    if (isOrcaTokenPlan(plan)) {
        return domainHash(ORCA_ROUTE_DOMAIN, canonicalJson({ pool: orcaPlanSides(plan).pool.pool, direction: "a_to_b", exactInput: true,
            tickArrays: plan.tickArrays, oracle: plan.oracle, sourceAccount: plan.sourceAccount, destinationAccount: plan.destinationAccount }));
    }
    return domainHash(ORCA_ROUTE_DOMAIN, canonicalJson({ pool: ORCA_SOL_USDC_POOL, direction: "sol_to_usdc_a_to_b", exactInput: true,
        tickArrays: plan.tickArrays, oracle: plan.oracle, wsolAccount: plan.wsolAccount, usdcAccount: plan.usdcAccount }));
}
/** The quote's `blockHash` is the message blockhash as 0x-prefixed hex, so the core's simulation schema stays exact. */
export function blockhashHex(value) { return `0x${Buffer.from(getBase58Encoder().encode(value)).toString("hex")}`; }
/** Priority fee in lamports: ceil(limit * micro-lamports / 1e6). */
export function priorityFeeLamports(plan) {
    return (BigInt(plan.computeUnitLimit) * BigInt(plan.computeUnitPriceMicroLamports) + 999999n) / 1000000n;
}
/** The new account rent the owner approved: the USDC account for sol-usdc, the destination account for a token pool. */
export function orcaApprovedRent(execution) {
    return execution.schemaVersion === ORCA_TOKEN_EXECUTION_SCHEMA ? execution.destinationAccountRentLamports : execution.usdcAccountRentLamports;
}
/** The output the simulation credited to the owner, whichever execution schema produced it. */
export function orcaSimulatedOutput(simulation) {
    return Object.hasOwn(simulation, "outputReceivedAtomic") ? simulation.outputReceivedAtomic
        : simulation.usdcReceivedAtomic;
}
export function orcaGasDisplay(execution) {
    return { computeUnitLimit: String(execution.plan.computeUnitLimit), computeUnitPriceMicroLamports: execution.plan.computeUnitPriceMicroLamports,
        simulatedComputeUnits: execution.simulation.unitsConsumed, networkFeeLamports: execution.networkFeeLamports,
        usdcAccountRentLamports: execution.usdcAccountRentLamports, wsolAccountRentLamports: execution.evidence.tokenAccountRentLamports,
        maximumSolSpendLamports: execution.maximumSolSpendLamports };
}
export function orcaTokenGasDisplay(execution) {
    return { computeUnitLimit: String(execution.plan.computeUnitLimit), computeUnitPriceMicroLamports: execution.plan.computeUnitPriceMicroLamports,
        simulatedComputeUnits: execution.simulation.unitsConsumed, networkFeeLamports: execution.networkFeeLamports,
        destinationAccountRentLamports: execution.destinationAccountRentLamports, maximumSolSpendLamports: execution.maximumSolSpendLamports };
}
/** Proves the stored plan, bytes, fee display and chain evidence are exactly the ones the quote hash binds. */
export function validateOrcaKeylessMaterial(value, mode = "stored") {
    const fail = (message) => { throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", message); };
    if (!isPlainRecord(value) || !exactKeys(value, ["quote", "approvalCapAtomic", "gasOrEnergy", "execution"]) || value.approvalCapAtomic !== "0" ||
        !isPlainRecord(value.execution) || !isPlainRecord(value.gasOrEnergy))
        fail("Orca prepared material schema is invalid.");
    const record = value, quote = validateSwapQuote(record.quote, mode), execution = record.execution;
    const token = execution.schemaVersion === ORCA_TOKEN_EXECUTION_SCHEMA;
    if (!exactKeys(execution, ["schemaVersion", "plan", "lifetime", "unsignedPayload", "messageHash", "networkFeeLamports",
        token ? "destinationAccountRentLamports" : "usdcAccountRentLamports", "maximumSolSpendLamports", "ownerSlippageCapBps", "evidence", "simulation"]) ||
        (!token && execution.schemaVersion !== ORCA_KEYLESS_EXECUTION_SCHEMA) || !isPlainRecord(execution.plan) || !isPlainRecord(execution.lifetime) ||
        !isPlainRecord(execution.evidence) || !isPlainRecord(execution.simulation) || typeof execution.unsignedPayload !== "string" ||
        token !== isOrcaTokenPlan(execution.plan)) {
        fail("Orca execution material is invalid.");
    }
    const typed = execution, plan = typed.plan;
    let sides;
    try {
        sides = orcaPlanSides(plan);
    }
    catch {
        return fail("Orca execution material is invalid.");
    }
    const pool = sides.pool, source = token ? { kind: "token", identifier: pool.mintA } : { kind: "native", identifier: null };
    if (quote.sourceAsset.chain !== ORCA_SOLANA_CHAIN || quote.destinationAsset.chain !== ORCA_SOLANA_CHAIN ||
        canonicalJson({ kind: quote.sourceAsset.kind, identifier: quote.sourceAsset.identifier }) !== canonicalJson(source) ||
        quote.destinationAsset.kind !== "token" || quote.destinationAsset.identifier !== (token ? pool.mintB : USDC_MINT) ||
        quote.account !== quote.recipient || plan.owner !== quote.account || sides.amountIn !== quote.inputAmountAtomic ||
        plan.minimumOutputAtomic !== quote.minimumOutputAtomic) {
        fail(`Orca material is not the pinned ${pool.symbolA} to ${pool.symbolB} exact-input pair for the quoted owner.`);
    }
    let compiled;
    try {
        compiled = compileOrcaSwap(plan, typed.lifetime);
    }
    catch {
        return fail("Orca unsigned transaction does not rebuild from its plan.");
    }
    if (compiled.unsignedPayload !== typed.unsignedPayload || compiled.messageHash !== typed.messageHash ||
        sha256(typed.unsignedPayload) !== quote.unsignedTransactionPayloadHash || orcaRouteHash(plan) !== quote.routeHash) {
        fail("Orca unsigned transaction is not bound to its quote.");
    }
    const evidence = typed.evidence, simulation = typed.simulation, rent = uint(orcaApprovedRent(typed), fail, false);
    const fee = uint(typed.networkFeeLamports, fail, true), maximum = uint(typed.maximumSolSpendLamports, fail, true);
    const destinationExists = token ? evidence.owner.destinationAccountExists : evidence.owner.usdcAccountExists;
    // sol-usdc spends the input, the fee and the rent in SOL; a token pool spends only the fee and the rent in SOL.
    if (orcaEvidenceHash(evidence) !== quote.providerResponseHash || evidence.swap.amountOutAtomic !== quote.expectedOutputAtomic ||
        evidence.swap.amountInAtomic !== quote.inputAmountAtomic || evidence.slot !== quote.simulation.blockNumber ||
        (destinationExists ? rent !== 0n : rent !== uint(evidence.tokenAccountRentLamports, fail, true)) ||
        maximum !== (token ? 0n : BigInt(quote.inputAmountAtomic)) + fee + rent || fee < SOLANA_BASE_FEE_LAMPORTS_PER_SIGNATURE + priorityFeeLamports(plan) ||
        !Number.isSafeInteger(typed.ownerSlippageCapBps) || typed.ownerSlippageCapBps < quote.slippageBps || typed.ownerSlippageCapBps > 10_000 ||
        evidence.swap.priceImpactBps > typed.ownerSlippageCapBps)
        fail("Orca on-chain quote evidence is not bound to its quote.");
    const received = uint(orcaSimulatedOutput(simulation), fail, false), spent = uint(simulation.solSpentLamports, fail, false);
    if (simulation.replaceRecentBlockhash !== true || simulation.slot !== quote.simulation.headBlockNumber ||
        simulation.unitsConsumed !== quote.simulation.gasEstimate || blockhashHex(typed.lifetime.blockhash) !== quote.simulation.blockHash ||
        quote.simulation.maxHeadDrift !== ORCA_MAX_SLOT_DRIFT || received < BigInt(quote.minimumOutputAtomic) ||
        spent > maximum || quote.simulation.resultHash !== simulation.resultHash ||
        quote.simulation.requestHash !== simulation.requestHash)
        fail("Orca simulation is not bound to its quote.");
    const display = typed.schemaVersion === ORCA_TOKEN_EXECUTION_SCHEMA ? orcaTokenGasDisplay(typed) : orcaGasDisplay(typed);
    if (canonicalJson(record.gasOrEnergy) !== canonicalJson(display))
        fail("Orca fee display is not bound to the material.");
    return value;
}
/** Saved-quote store: GuardedSwapReadOnlyBuilder.load resolves prepared material here by quote hash. */
export class SavedOrcaQuoteStore extends SecureStateStore {
    initialized;
    async save(value) {
        const material = validateOrcaKeylessMaterial(value, "input");
        await this.ready();
        return await this.withLocks([`swap-quote:${material.quote.quoteHash}`], async () => {
            const existing = await this.readJson(this.path(material.quote.quoteHash));
            if (existing !== null) {
                if (canonicalJson(validateOrcaKeylessMaterial(existing)) !== canonicalJson(material)) {
                    throw new ApnError("APN_STATE_CORRUPT", "A different Orca material already owns this quote hash.");
                }
                return material;
            }
            await this.writeJson(this.path(material.quote.quoteHash), material, true);
            return material;
        });
    }
    async load(quoteHash) {
        stateIdentifier(quoteHash, "swap quote hash");
        await this.ready();
        const value = await this.readJson(this.path(quoteHash));
        if (value === null)
            return null;
        const material = validateOrcaKeylessMaterial(value);
        if (material.quote.quoteHash !== quoteHash)
            throw new ApnError("APN_STATE_CORRUPT", "Saved Orca quote path binding is invalid.");
        return material;
    }
    path(quoteHash) { return `orca-swap-quotes/${quoteHash}.json`; }
    async ready() { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-swap-quotes"); })(); await this.initialized; }
}
function uint(value, fail, positive) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value) || (positive && value === "0"))
        fail("Orca material integer is invalid.");
    return BigInt(value);
}
//# sourceMappingURL=material.js.map