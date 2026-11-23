import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapQuote } from "../quote.js";
import { UNISWAP_CHAIN } from "../uniswap-pin.js";
import { encodeUniswapV3ExactInput } from "./encoder.js";
import { uniswapNativeLaneOf } from "./native-lane.js";
import { ETHEREUM_WBTC, UNISWAP_WBTC_CODE_PINS } from "./pins.js";
export const UNISWAP_KEYLESS_EXECUTION_SCHEMA = "apn.uniswap-v3-keyless-execution.v1";
export const UNISWAP_KEYLESS_EVIDENCE_DOMAIN = "apn.uniswap-v3-onchain-evidence.v1";
export function uniswapEvidenceHash(evidence) {
    return domainHash(UNISWAP_KEYLESS_EVIDENCE_DOMAIN, canonicalJson(evidence));
}
/**
 * Proves the stored unsigned transaction, gas display and chain evidence are exactly the ones the quote hash binds, on the
 * native-input lane of the quote's own chain (Ethereum or BNB Smart Chain): its router, chain id, pinned pair and decoder.
 */
export function validateUniswapKeylessMaterial(value, mode = "stored") {
    const fail = (message) => { throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", message); };
    if (!isPlainRecord(value) || !exactKeys(value, ["quote", "approvalCapAtomic", "gasOrEnergy", "execution"]) ||
        value.approvalCapAtomic !== "0" || !isPlainRecord(value.execution) || !isPlainRecord(value.gasOrEnergy))
        fail("Uniswap prepared material schema is invalid.");
    const record = value, quote = validateSwapQuote(record.quote, mode);
    const execution = record.execution;
    if (!exactKeys(execution, ["schemaVersion", "envelope", "deadline", "evidence"]) || execution.schemaVersion !== UNISWAP_KEYLESS_EXECUTION_SCHEMA ||
        !isPlainRecord(execution.envelope) || !isPlainRecord(execution.evidence) || typeof execution.deadline !== "number")
        fail("Uniswap execution material is invalid.");
    const envelope = execution.envelope, deadline = execution.deadline;
    const evidence = execution.evidence;
    const lane = uniswapNativeLaneOf(quote.sourceAsset.chain);
    if (lane === undefined || quote.destinationAsset.chain !== lane.chain || quote.sourceAsset.kind !== "native" ||
        quote.destinationAsset.kind !== "token" || quote.destinationAsset.identifier === null)
        fail("Uniswap material is not a pinned native exact-input pair.");
    const pair = lane.pair(quote.destinationAsset.identifier);
    if (pair.outputToken === ETHEREUM_WBTC && BigInt(quote.minimumOutputAtomic) < 1000n)
        fail("WBTC output floor is below 1000 atomic.");
    if (!exactKeys(envelope, ["from", "to", "data", "value", "gasLimit", "chainId", "maxFeePerGas", "maxPriorityFeePerGas"]) ||
        envelope.from !== quote.account || envelope.to !== lane.router || envelope.chainId !== lane.chainId || envelope.value !== quote.inputAmountAtomic ||
        typeof envelope.data !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(envelope.data) || envelope.data.length > 131_074 ||
        sha256(canonicalJson(envelope)) !== quote.unsignedTransactionPayloadHash || !Number.isSafeInteger(deadline) ||
        deadline !== Math.floor(Date.parse(quote.expiresAt) / 1000))
        fail("Uniswap unsigned transaction is not bound to its quote.");
    const gasLimit = uint(envelope.gasLimit, fail), maxFee = uint(envelope.maxFeePerGas, fail), priority = uint(envelope.maxPriorityFeePerGas ?? "", fail, false);
    if (priority > maxFee || BigInt(quote.simulation.gasEstimate) > gasLimit)
        fail("Uniswap gas envelope is inconsistent.");
    if (canonicalJson(record.gasOrEnergy) !== canonicalJson(uniswapGasDisplay(envelope)))
        fail("Uniswap gas display is not bound to the envelope.");
    const route = lane.decode(envelope.data, { recipient: quote.recipient, inputAmountAtomic: quote.inputAmountAtomic,
        minimumOutputAtomic: quote.minimumOutputAtomic, deadline, outputToken: pair.outputToken });
    if (pair.outputToken === ETHEREUM_WBTC && (quote.destinationAsset.chain !== UNISWAP_CHAIN || envelope.data !== encodeUniswapV3ExactInput({ recipient: quote.recipient, inputAmountAtomic: quote.inputAmountAtomic, minimumOutputAtomic: quote.minimumOutputAtomic, deadline, pair }).data))
        fail("WBTC requires the exact single pinned V3 path.");
    if (route.routeHash !== quote.routeHash || route.minimumOutputAtomic !== quote.minimumOutputAtomic)
        fail("Uniswap route is not bound to its quote.");
    if (!exactKeys(evidence, ["chainId", "blockNumber", "blockHash", "baseFeePerGas", "accountBalanceWei", "codePins", "pool"]) ||
        evidence.chainId !== lane.chainId || evidence.blockNumber !== quote.simulation.blockNumber || evidence.blockHash !== quote.simulation.blockHash ||
        !isPlainRecord(evidence.pool) || evidence.pool.pool !== pair.pool || evidence.pool.fee !== pair.fee ||
        evidence.pool.amountOutAtomic !== quote.expectedOutputAtomic || uniswapEvidenceHash(evidence) !== quote.providerResponseHash) {
        fail("Uniswap on-chain quote evidence is not bound to its quote.");
    }
    if (pair.outputToken === ETHEREUM_WBTC && canonicalJson(evidence.codePins) !== canonicalJson(UNISWAP_WBTC_CODE_PINS))
        fail("WBTC code pin evidence is not the reviewed route.");
    if (getAddress(pair.pool) !== pair.pool)
        fail("Uniswap pair pin is not canonical.");
    return value;
}
export function uniswapGasDisplay(envelope) {
    const maxFee = envelope.maxFeePerGas ?? envelope.gasPrice;
    return { gasLimit: envelope.gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: envelope.maxPriorityFeePerGas ?? "0",
        maximumGasCostWei: (BigInt(envelope.gasLimit) * BigInt(maxFee)).toString() };
}
/** Saved-quote store: GuardedSwapReadOnlyBuilder.load resolves prepared material here by quote hash. */
export class SavedUniswapQuoteStore extends SecureStateStore {
    initialized;
    async save(value) {
        const material = validateUniswapKeylessMaterial(value, "input");
        await this.ready();
        return await this.withLocks([`swap-quote:${material.quote.quoteHash}`], async () => {
            const existing = await this.readJson(this.path(material.quote.quoteHash));
            if (existing !== null) {
                if (canonicalJson(validateUniswapKeylessMaterial(existing)) !== canonicalJson(material)) {
                    throw new ApnError("APN_STATE_CORRUPT", "A different Uniswap material already owns this quote hash.");
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
        const material = validateUniswapKeylessMaterial(value);
        if (material.quote.quoteHash !== quoteHash)
            throw new ApnError("APN_STATE_CORRUPT", "Saved Uniswap quote path binding is invalid.");
        return material;
    }
    path(quoteHash) { return `swap-quotes/${quoteHash}.json`; }
    async ready() { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("swap-quotes"); })(); await this.initialized; }
}
function uint(value, fail, positive = true) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value) || (positive && value === "0"))
        fail("Uniswap gas integer is invalid.");
    return BigInt(value);
}
//# sourceMappingURL=material.js.map