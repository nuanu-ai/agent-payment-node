import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parseAtomic } from "../../money.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateUniswapTokenRoute } from "./token-route.js";
export const UNISWAP_TOKEN_MATERIAL_SCHEMA = "apn.uniswap-token-material.v1";
export function createUniswapTokenMaterial(input) {
    const body = { schemaVersion: UNISWAP_TOKEN_MATERIAL_SCHEMA, ...input };
    return validateUniswapTokenMaterial({ ...body, quoteHash: hashObject(body) }, "input");
}
export function validateUniswapTokenMaterial(value, mode = "stored") {
    const fail = (message) => { throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", message); };
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "quoteHash", "profile", "account", "route", "expectedOutputAtomic",
        "approvalCapAtomic", "allowanceAtPrepare", "approvalGas", "swapGas", "cleanupGas", "maximumNativeDebitWei", "policyDigest",
        "mechanismDigest", "blockNumber", "blockHash", "createdAt"]) || value.schemaVersion !== UNISWAP_TOKEN_MATERIAL_SCHEMA)
        fail("Uniswap token material schema is invalid.");
    const material = value, route = validateUniswapTokenRoute(material.route), { quoteHash, ...body } = material;
    if (!/^[a-f0-9]{64}$/u.test(quoteHash) || quoteHash !== hashObject(body) || material.approvalCapAtomic !== route.amountIn ||
        !["0", route.amountIn].includes(material.allowanceAtPrepare) || uint(material.expectedOutputAtomic) < uint(route.amountOutMinimum) ||
        !/^[a-f0-9]{64}$/u.test(material.policyDigest) || !/^[a-f0-9]{64}$/u.test(material.mechanismDigest) ||
        !/^0x[a-f0-9]{64}$/u.test(material.blockHash) || !instant(material.createdAt))
        fail("Uniswap token material binding is invalid.");
    const maximum = gas(material.approvalGas) + gas(material.swapGas) + gas(material.cleanupGas);
    if (uint(material.maximumNativeDebitWei) < maximum)
        fail("Uniswap token native debit budget does not cover all effects.");
    void uint(material.blockNumber);
    void canonicalJson(material);
    return material;
}
export class SavedUniswapTokenMaterialStore extends SecureStateStore {
    async save(value) {
        const material = validateUniswapTokenMaterial(value, "input");
        await this.initialize();
        await this.ensureDirectory("uniswap-token-quotes");
        return await this.withLocks([`uniswap-token-quote:${material.quoteHash}`], async () => {
            const prior = await this.readJson(this.path(material.quoteHash));
            if (prior !== null && canonicalJson(validateUniswapTokenMaterial(prior)) !== canonicalJson(material))
                fail("A different token quote owns this hash.");
            if (prior === null)
                await this.writeJson(this.path(material.quoteHash), material, true);
            return material;
        });
    }
    async load(hash) {
        stateIdentifier(hash, "Uniswap token quote");
        await this.initialize();
        const value = await this.readJson(this.path(hash));
        if (value === null)
            return null;
        const material = validateUniswapTokenMaterial(value);
        if (material.quoteHash !== hash)
            fail("Uniswap token quote path binding is invalid.");
        return material;
    }
    path(hash) { return `uniswap-token-quotes/${hash}.json`; }
}
function gas(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) || uint(value.maxPriorityFeePerGas) > uint(value.maxFeePerGas))
        fail("Uniswap token gas envelope is invalid.");
    return uint(value.gasLimit) * uint(value.maxFeePerGas);
}
function uint(value) {
    try {
        if (typeof value !== "string")
            throw new Error();
        return parseAtomic(value);
    }
    catch {
        return fail("Uniswap token integer is invalid.");
    }
}
function instant(value) { const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString() === value; }
function fail(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=token-material.js.map