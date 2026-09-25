import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { tronAddress } from "./tron/codec.js";
import { validateSwapMechanismPin } from "./swap/pin.js";
export const ASSET_POLICY_REGISTRY_SCHEMA = "apn.asset-policy-registry.v1";
/** Version 2 replaces the single asset cap pair with exactly one owner cap pair per admitted rail. */
export const ASSET_POLICY_REGISTRY_SCHEMA_V2 = "apn.asset-policy-registry.v2";
const MAX_CHAINS = 64;
const MAX_ASSETS_PER_CHAIN = 256;
const MAX_UINT256 = (1n << 256n) - 1n;
export function bridgeMechanismAdmitted(admission, mechanism) {
    if (admission.rail !== "bridge")
        return false;
    const options = admission.asset.mechanismOptions?.bridge;
    if (options !== undefined)
        return options.some((option) => option.provider === mechanism.provider && option.reference === mechanism.reference);
    const pin = admission.asset.mechanismPins?.bridge;
    return pin?.provider === mechanism.provider && pin.reference === mechanism.reference;
}
export function assetPolicyDigest(value) {
    validateRegistryBody(value);
    return domainHash(value.schemaVersion, canonicalJson(value));
}
export function sealAssetPolicyRegistry(value) {
    return validateAssetPolicyRegistry({ ...value, policyDigest: assetPolicyDigest(value) });
}
export function validateAssetPolicyRegistry(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "registryVersion", "publishedAt", "effectiveDate", ...(value.effectiveAt === undefined ? [] : ["effectiveAt"]),
        ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "chains", "policyDigest",
    ]))
        invalid("The asset policy registry schema is invalid.");
    const { policyDigest, ...body } = value;
    validateRegistryBody(body);
    if (typeof policyDigest !== "string" || !/^[a-f0-9]{64}$/u.test(policyDigest) ||
        domainHash(body.schemaVersion, canonicalJson(body)) !== policyDigest) {
        invalid("The asset policy registry digest is invalid.");
    }
    return value;
}
/** Shared fail-closed evaluator for future CLI and MCP admission surfaces. */
export function evaluateAssetPolicy(registryValue, input) {
    const registry = validateAssetPolicyRegistry(registryValue);
    validateEvaluationInput(input);
    const asOfDate = calendarDate(input.asOfDate, "Policy evaluation date");
    if (asOfDate < registry.effectiveDate)
        denied("The asset policy registry is not effective on the requested date.");
    if (registry.effectiveAt !== undefined || registry.expiresAt !== undefined) {
        if (input.asOf === undefined || !isIsoInstant(input.asOf) || input.asOf.slice(0, 10) !== asOfDate) {
            invalid("Policy evaluation requires an exact instant matching the requested UTC date.");
        }
        if (registry.effectiveAt !== undefined && input.asOf < registry.effectiveAt)
            denied("The asset policy registry is not yet effective.");
        if (registry.expiresAt !== undefined && input.asOf >= registry.expiresAt)
            denied("The asset policy registry has expired.");
    }
    const rail = policyRail(input.rail);
    const chain = registry.chains.find((row) => row.chain === input.chain);
    if (chain === undefined)
        denied("The network is not listed in the asset policy registry.");
    // Validation is intentionally performed against the selected chain family before lookup, so aliases,
    // sentinels and non-canonical spellings can never select a token row.
    const identifier = input.asset.kind === "native" ? null : canonicalTokenIdentifier(chain.family, input.asset.identifier);
    const asset = chain.assets.find((row) => row.kind === input.asset.kind && row.identifier === identifier);
    if (asset === undefined)
        denied("The asset is not listed for this network.");
    if (!asset.rails[rail])
        denied("The selected rail is not admitted for this network and asset.");
    // Version 2 caps are per rail; the caller's daily usage stays the asset's combined usage, so a rail cap is never widened.
    const caps = registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? asset.railCaps?.[rail] : asset.caps;
    if (caps === undefined)
        invalid("The asset policy registry lacks caps for the admitted rail.");
    const amount = atomic(input.amountAtomic, true, "Transfer amount");
    const usage = atomic(input.dailyUsageAtomic, false, "Daily usage");
    const options = asset.mechanismOptions?.bridge;
    let selected;
    if (rail === "bridge" && options !== undefined) {
        if (input.mechanism === undefined)
            denied("An exact bridge mechanism is required by the asset policy.");
        selected = options.find((option) => option.provider === input.mechanism.provider && option.reference === input.mechanism.reference);
        if (selected === undefined)
            denied("The bridge mechanism is not admitted by the asset policy.");
    }
    const perTransfer = BigInt(selected?.maximumPerTransferAtomic ?? caps.maximumPerTransferAtomic);
    const dailyLimit = BigInt(caps.dailyLimitAtomic);
    if (amount > perTransfer)
        denied("The transfer exceeds the asset policy per-transfer cap.");
    if (usage > dailyLimit || usage + amount > dailyLimit)
        denied("The transfer exceeds the asset policy daily cap.");
    return {
        admitted: true,
        policyDigest: registry.policyDigest,
        registryVersion: registry.registryVersion,
        effectiveDate: registry.effectiveDate,
        chain: chain.chain,
        family: chain.family,
        asset,
        rail,
        caps: { maximumPerTransferAtomic: selected?.maximumPerTransferAtomic ?? caps.maximumPerTransferAtomic,
            dailyLimitAtomic: caps.dailyLimitAtomic },
        amountAtomic: amount.toString(),
        dailyUsageAtomic: usage.toString(),
        dailyRemainingAtomic: (dailyLimit - usage - amount).toString(),
    };
}
function validateEvaluationInput(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "chain", "asset", "rail", "amountAtomic", "dailyUsageAtomic", "asOfDate", ...(value.asOf === undefined ? [] : ["asOf"]),
        ...(value.mechanism === undefined ? [] : ["mechanism"]),
    ]) || typeof value.chain !== "string" || !isPlainRecord(value.asset) ||
        !exactKeys(value.asset, ["kind", "identifier"]) ||
        (value.asset.kind !== "native" && value.asset.kind !== "token") ||
        (value.asset.kind === "native" ? value.asset.identifier !== null : typeof value.asset.identifier !== "string") ||
        (value.mechanism !== undefined && (!isPlainRecord(value.mechanism) || !exactKeys(value.mechanism, ["provider", "reference"]) ||
            typeof value.mechanism.provider !== "string" || typeof value.mechanism.reference !== "string"))) {
        invalid("The asset policy evaluation input schema is invalid.");
    }
}
function validateRegistryBody(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "registryVersion", "publishedAt", "effectiveDate",
        ...(value.effectiveAt === undefined ? [] : ["effectiveAt"]), ...(value.expiresAt === undefined ? [] : ["expiresAt"]), "chains"]) ||
        (value.schemaVersion !== ASSET_POLICY_REGISTRY_SCHEMA && value.schemaVersion !== ASSET_POLICY_REGISTRY_SCHEMA_V2) ||
        typeof value.registryVersion !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.registryVersion) ||
        typeof value.publishedAt !== "string" || !isIsoInstant(value.publishedAt)) {
        invalid("The asset policy registry metadata is invalid.");
    }
    const effectiveDate = calendarDate(value.effectiveDate, "Registry effective date");
    if (value.effectiveAt !== undefined && (typeof value.effectiveAt !== "string" || !isIsoInstant(value.effectiveAt) ||
        value.effectiveAt.slice(0, 10) !== effectiveDate))
        invalid("Registry effective instant is invalid.");
    if (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !isIsoInstant(value.expiresAt) ||
        (value.effectiveAt === undefined ? value.expiresAt.slice(0, 10) <= effectiveDate : value.expiresAt <= value.effectiveAt))) {
        invalid("Registry expiry instant is invalid.");
    }
    if (!Array.isArray(value.chains) || value.chains.length === 0 || value.chains.length > MAX_CHAINS) {
        invalid("The asset policy registry must contain a bounded, non-empty chain list.");
    }
    const identities = new Set();
    for (const chain of value.chains) {
        validateChain(chain, value.schemaVersion);
        if (identities.has(chain.chain))
            invalid("The asset policy registry contains a duplicate chain identity.");
        identities.add(chain.chain);
    }
}
function validateChain(value, schema) {
    if (!isPlainRecord(value) || !exactKeys(value, ["chain", "family", "name", "assets"]) ||
        (value.family !== "evm" && value.family !== "solana" && value.family !== "tron") ||
        typeof value.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 .()/-]{0,63}$/u.test(value.name) ||
        !canonicalChain(value.family, value.chain) || !Array.isArray(value.assets) || value.assets.length === 0 ||
        value.assets.length > MAX_ASSETS_PER_CHAIN) {
        invalid("An asset policy chain row is invalid.");
    }
    const identities = new Set();
    for (const asset of value.assets) {
        validateAsset(value.family, asset, schema);
        if (asset.gaslessRecipient !== undefined && value.chain !== "eip155:1" && value.chain !== "eip155:8453") {
            invalid("A local gasless recipient pin requires Ethereum or Base.");
        }
        const identity = asset.kind === "native" ? "native" : `token:${asset.identifier}`;
        if (identities.has(identity))
            invalid("An asset policy chain contains a duplicate asset identity.");
        identities.add(identity);
    }
}
function validateAsset(family, value, schema) {
    const perRail = schema === ASSET_POLICY_REGISTRY_SCHEMA_V2;
    if (!isPlainRecord(value) || !exactKeys(value, ["kind", "identifier", "symbol", "decimals", "rails", perRail ? "railCaps" : "caps",
        ...(value.mechanismPins === undefined ? [] : ["mechanismPins"]),
        ...(value.mechanismOptions === undefined ? [] : ["mechanismOptions"]),
        ...(value.gaslessRecipient === undefined ? [] : ["gaslessRecipient"])]) ||
        (value.kind !== "native" && value.kind !== "token") ||
        typeof value.symbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/u.test(value.symbol) ||
        typeof value.decimals !== "number" || !Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) {
        invalid("An asset policy asset row is invalid.");
    }
    if (value.kind === "native") {
        if (value.identifier !== null)
            invalid("A native asset must use the null identity.");
    }
    else if (typeof value.identifier !== "string" || canonicalTokenIdentifier(family, value.identifier) !== value.identifier) {
        invalid("A token must use its canonical contract or mint address.");
    }
    validateRails(value.rails);
    if (perRail)
        validateRailCaps(value.rails, value.railCaps);
    else
        validateCaps(value.caps);
    if (value.mechanismPins !== undefined)
        validateMechanismPins(value.mechanismPins);
    if (value.gaslessRecipient !== undefined) {
        if (family !== "evm" || !value.rails.gasless ||
            value.mechanismPins?.gasless?.provider !== "local" ||
            typeof value.gaslessRecipient !== "string" || canonicalEvmRecipient(value.gaslessRecipient) !== value.gaslessRecipient) {
            invalid("A local gasless recipient pin must be one canonical EVM address.");
        }
    }
    if (value.mechanismOptions !== undefined) {
        const options = value.mechanismOptions;
        if (schema !== ASSET_POLICY_REGISTRY_SCHEMA_V2 || !value.rails.bridge ||
            !isPlainRecord(value.mechanismOptions) || !exactKeys(value.mechanismOptions, ["bridge"]) ||
            !Array.isArray(options.bridge) || options.bridge.length < 2 ||
            options.bridge.length > 16 || value.mechanismPins?.bridge !== undefined)
            invalid("Bridge mechanism alternatives are invalid.");
        const keys = new Set();
        for (const option of options.bridge) {
            if (!isPlainRecord(option) || !exactKeys(option, ["provider", "reference", "maximumPerTransferAtomic"]))
                invalid("Bridge mechanism alternative is invalid.");
            validateMechanismPins({ bridge: { provider: option.provider, reference: option.reference } });
            const cap = atomic(option.maximumPerTransferAtomic, true, "Bridge mechanism cap");
            if (cap > BigInt(value.railCaps.bridge.maximumPerTransferAtomic))
                invalid("Bridge mechanism cap exceeds rail cap.");
            const key = `${option.provider}\0${option.reference}`;
            if (keys.has(key))
                invalid("Bridge mechanism alternative is duplicated.");
            keys.add(key);
        }
    }
    const mechanismPins = value.mechanismPins;
    const swapPin = mechanismPins?.swap;
    if (value.rails.swap !== (swapPin !== undefined))
        invalid("Swap admission requires exactly one immutable swap mechanism pin.");
    if (mechanismPins !== undefined && "direct" in mechanismPins)
        invalid("Direct admission cannot carry mechanism metadata.");
}
function canonicalEvmRecipient(value) {
    try {
        const result = getAddress(value);
        return result === "0x0000000000000000000000000000000000000000" ? null : result;
    }
    catch {
        return null;
    }
}
function validateMechanismPins(value) {
    if (!isPlainRecord(value) || Object.keys(value).some((key) => !["gasless", "x402", "bridge", "swap"].includes(key))) {
        invalid("Asset mechanism pins are invalid.");
    }
    for (const [rail, pin] of Object.entries(value)) {
        if (rail === "swap") {
            validateSwapMechanismPin(pin);
            continue;
        }
        if (!isPlainRecord(pin) || !exactKeys(pin, ["provider", "reference"]) || typeof pin.provider !== "string" ||
            typeof pin.reference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u.test(pin.provider) ||
            !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u.test(pin.reference))
            invalid("Asset mechanism pins are invalid.");
    }
}
function validateRails(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["direct", "gasless", "x402", "bridge", "swap"]) ||
        Object.values(value).some((admitted) => typeof admitted !== "boolean")) {
        invalid("Asset rail admission flags are invalid.");
    }
}
function validateRailCaps(rails, value) {
    const admitted = Object.keys(rails).filter((rail) => rails[rail]);
    if (admitted.length === 0 || !isPlainRecord(value) || !exactKeys(value, admitted)) {
        invalid("Per-rail caps must exist for exactly the admitted rails.");
    }
    for (const rail of admitted)
        validateCaps(value[rail]);
}
function validateCaps(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["maximumPerTransferAtomic", "dailyLimitAtomic"])) {
        invalid("Asset atomic caps are invalid.");
    }
    const maximum = atomic(value.maximumPerTransferAtomic, true, "Per-transfer cap");
    const daily = atomic(value.dailyLimitAtomic, true, "Daily cap");
    if (maximum > daily)
        invalid("The per-transfer cap cannot exceed the daily cap.");
}
function canonicalChain(family, value) {
    if (typeof value !== "string")
        return false;
    if (family === "evm") {
        const match = /^eip155:([1-9][0-9]{0,77})$/u.exec(value);
        return match !== null && BigInt(match[1]) <= MAX_UINT256;
    }
    if (family === "solana") {
        if (!/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value))
            return false;
        try {
            return solanaAddress(value.slice("solana:".length)) === value.slice("solana:".length);
        }
        catch {
            return false;
        }
    }
    return /^tron:[a-f0-9]{64}$/u.test(value);
}
function canonicalTokenIdentifier(family, value) {
    if (typeof value !== "string")
        invalid("Token identity must be a canonical contract or mint address.");
    try {
        if (family === "evm") {
            const canonical = getAddress(value);
            if (canonical === "0x0000000000000000000000000000000000000000" || canonical !== value)
                throw new Error("non-canonical");
            return canonical;
        }
        if (family === "solana")
            return solanaAddress(value);
        return tronAddress(value);
    }
    catch {
        return invalid("Token identity must be a canonical contract or mint address.");
    }
}
function policyRail(value) {
    if (value !== "direct" && value !== "gasless" && value !== "x402" && value !== "bridge" && value !== "swap") {
        return invalid("Policy rail is invalid.");
    }
    return value;
}
function atomic(value, positive, label) {
    try {
        if (typeof value !== "string" || value.length > 78)
            throw new Error("bounded uint256");
        const parsed = parseAtomic(value, { positive });
        if (parsed > MAX_UINT256)
            throw new Error("uint256");
        return parsed;
    }
    catch {
        return invalid(`${label} must be a canonical uint256 atomic amount${positive ? " greater than zero" : ""}.`);
    }
}
function calendarDate(value, label) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
        new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
        return invalid(`${label} must be an exact UTC calendar date.`);
    }
    return value;
}
function isIsoInstant(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function denied(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=asset-policy-registry.js.map