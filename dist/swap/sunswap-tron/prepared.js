import { canonicalJson, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapQuote } from "../quote.js";
import { SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, SUNSWAP_TRON_CHAIN, SUNSWAP_USDT } from "./catalog.js";
import { priceSunSwapV2Market, validateSunSwapV2Market } from "./market.js";
import { sunSwapOnChainEvidenceHash } from "./quote.js";
import { sunSwapUnsignedPayloadHash, validateEnergyBounds, validateSunSwapUnsignedTransaction, } from "./transaction.js";
export const SUNSWAP_EXECUTION_MATERIAL_SCHEMA = "apn.sunswap-tron-v2-execution-material.v1";
/** Display of the TRON resource bound; every value is derived from the frozen intent and the exact simulation. */
export function sunSwapGasOrEnergy(intent, simulation, transaction) {
    const energy = BigInt(simulation.energyRequired), price = BigInt(intent.energyPriceSun);
    return { resource: "tron_energy", energyUsed: energy.toString(), energyPriceSun: price.toString(),
        estimatedEnergyFeeSun: (energy * price).toString(), feeLimitSun: intent.feeLimitSun, maximumEnergy: intent.maximumEnergy,
        callValueSun: intent.callValueAtomic, maximumTrxDebitSun: (BigInt(intent.callValueAtomic) + BigInt(intent.feeLimitSun)).toString(),
        rawDataBytes: (transaction.raw_data_hex.length / 2).toString() };
}
/** Re-derives every binding between quote, market, pricing, unsigned transaction, simulation and resource display. */
export function validateSunSwapPreparedMaterial(value, mode) {
    if (mode === "stored") {
        try {
            return validateMaterial(value, "stored");
        }
        catch {
            throw new ApnError("APN_STATE_CORRUPT", "Persisted SunSwap prepared material failed validation.");
        }
    }
    return validateMaterial(value, "input");
}
function validateMaterial(value, mode) {
    if (!isPlainRecord(value) || !exactKeys(value, ["quote", "approvalCapAtomic", "gasOrEnergy", "execution"]) ||
        value.approvalCapAtomic !== "0" || !isPlainRecord(value.execution) || !exactKeys(value.execution, ["schemaVersion", "intent", "transaction", "simulation", "market", "pricing"]) ||
        value.execution.schemaVersion !== SUNSWAP_EXECUTION_MATERIAL_SCHEMA || !isPlainRecord(value.execution.pricing))
        mismatch();
    const quote = validateSwapQuote(value.quote, mode), execution = value.execution;
    const market = validateSunSwapV2Market(execution.market, mode);
    const pricing = priceSunSwapV2Market(market, quote.slippageBps, execution.pricing.ownerSlippageCapBps, mode);
    if (canonicalJson(pricing) !== canonicalJson(execution.pricing))
        mismatch();
    const intent = execution.intent, transaction = validateSunSwapUnsignedTransaction(execution.transaction, intent);
    if (intent.owner !== quote.account || intent.recipient !== quote.recipient || quote.recipient !== quote.account ||
        intent.inputAmountAtomic !== quote.inputAmountAtomic || intent.inputAmountAtomic !== market.amountInAtomic ||
        intent.callValueAtomic !== intent.inputAmountAtomic || intent.minimumOutputAtomic !== quote.minimumOutputAtomic ||
        quote.minimumOutputAtomic !== pricing.minimumOutputAtomic || quote.expectedOutputAtomic !== pricing.expectedOutputAtomic ||
        intent.referenceBlockId !== market.referenceBlock.id || intent.maximumFeeLimitSun !== intent.feeLimitSun ||
        intent.maximumEnergy !== (BigInt(intent.feeLimitSun) / BigInt(intent.energyPriceSun)).toString() ||
        intent.expirationMs !== (BigInt(intent.deadlineSeconds) * 1000n).toString() ||
        quote.effectiveAt !== new Date(Number(intent.timestampMs)).toISOString() ||
        quote.expiresAt !== new Date(Number(intent.expirationMs)).toISOString())
        mismatch();
    validateEnergyBounds({ maximumEnergy: intent.maximumEnergy, energyPriceSun: intent.energyPriceSun,
        maximumFeeLimitSun: intent.maximumFeeLimitSun, feeLimitSun: intent.feeLimitSun });
    if (quote.sourceAsset.chain !== SUNSWAP_TRON_CHAIN || quote.sourceAsset.kind !== "native" || quote.sourceAsset.identifier !== null ||
        quote.destinationAsset.chain !== SUNSWAP_TRON_CHAIN || quote.destinationAsset.kind !== "token" ||
        quote.destinationAsset.identifier !== SUNSWAP_USDT || quote.routeHash !== market.routeHash ||
        quote.providerResponseHash !== sunSwapOnChainEvidenceHash(market) ||
        quote.unsignedTransactionPayloadHash !== sunSwapUnsignedPayloadHash(transaction))
        mismatch();
    const simulation = execution.simulation;
    if (!isPlainRecord(simulation) || !exactKeys(simulation, ["requestHash", "resultHash", "success", "energyRequired", "feeLimitSun",
        "blockNumber", "blockHash", "headBlockNumber", "maxHeadDrift", "gasEstimate"]) ||
        canonicalJson({ ...simulation, energyRequired: undefined, feeLimitSun: undefined }) !== canonicalJson(quote.simulation) ||
        simulation.energyRequired !== simulation.gasEstimate || simulation.feeLimitSun !== intent.feeLimitSun ||
        simulation.blockHash !== `0x${intent.referenceBlockId}` || simulation.blockNumber !== market.referenceBlock.number ||
        simulation.maxHeadDrift !== SUNSWAP_MAX_HEAD_DRIFT_BLOCKS || typeof simulation.energyRequired !== "string" ||
        !/^[1-9][0-9]{0,15}$/u.test(simulation.energyRequired) || BigInt(simulation.energyRequired) > BigInt(intent.maximumEnergy) ||
        BigInt(simulation.energyRequired) * BigInt(intent.energyPriceSun) > BigInt(intent.feeLimitSun))
        mismatch();
    if (!isPlainRecord(value.gasOrEnergy) || canonicalJson(value.gasOrEnergy) !== canonicalJson(sunSwapGasOrEnergy(intent, simulation, transaction)))
        mismatch();
    return value;
}
/** Owner-private durable prepared material keyed by quoteHash; create-only and fully re-validated on every read. */
export class SunSwapPreparedMaterialStore extends SecureStateStore {
    initialized;
    async save(value) {
        const material = validateSunSwapPreparedMaterial(value, "input");
        await this.ready();
        return await this.withLocks([`operation:${material.quote.quoteHash}`], async () => {
            const existing = await this.readJson(this.path(material.quote.quoteHash));
            if (existing !== null) {
                const stored = this.bound(existing, material.quote.quoteHash);
                if (canonicalJson(stored) === canonicalJson(material))
                    return stored;
                throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap quote hash is already owned by different prepared material.");
            }
            await this.writeJson(this.path(material.quote.quoteHash), material, true);
            return material;
        });
    }
    async load(quoteHash) {
        stateIdentifier(quoteHash, "SunSwap quote hash");
        await this.ready();
        return await this.withLocks([`operation:${quoteHash}`], async () => {
            const value = await this.readJson(this.path(quoteHash));
            return value === null ? null : this.bound(value, quoteHash);
        });
    }
    bound(value, quoteHash) {
        const material = validateSunSwapPreparedMaterial(value, "stored");
        if (material.quote.quoteHash !== quoteHash)
            throw new ApnError("APN_STATE_CORRUPT", "SunSwap prepared material path binding is invalid.");
        return material;
    }
    path(quoteHash) { return `sunswap-tron-prepared/${quoteHash}.json`; }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("sunswap-tron-prepared"); })();
        await this.initialized;
    }
}
function mismatch() { throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap prepared material bindings do not match."); }
//# sourceMappingURL=prepared.js.map