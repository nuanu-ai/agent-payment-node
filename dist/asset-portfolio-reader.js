import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { validateAssetPolicyRegistry } from "./asset-policy-registry.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { tronAddress } from "./tron/codec.js";
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_RETRIES = 2;
class AssetPortfolioCache {
    entries = new Map();
    lookup(key, nowMs) {
        const value = this.entries.get(key);
        if (value === undefined)
            return null;
        if (nowMs < value.expiresAtMs)
            return { state: "fresh", value: structuredClone(value) };
        this.entries.delete(key);
        return { state: "expired", value: structuredClone(value) };
    }
    store(key, value) { this.entries.set(key, structuredClone(value)); }
}
export class AssetPortfolioReader {
    ports;
    now;
    wait;
    cache = new AssetPortfolioCache();
    constructor(ports, now = Date.now, wait = async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds))) {
        this.ports = ports;
        this.now = now;
        this.wait = wait;
        for (const family of ["evm", "solana", "tron"]) {
            if (ports[family].family !== family || !source(ports[family].source))
                invalid("A portfolio balance port is invalid.");
        }
    }
    async read(registryValue, accountsValue, cachePolicyValue) {
        const registry = validateAssetPolicyRegistry(registryValue);
        const accounts = portfolioAccounts(accountsValue, registry.chains);
        const cachePolicy = cachePolicyContract(cachePolicyValue);
        const networks = [];
        let requestCount = 0;
        for (const chain of [...registry.chains].sort((left, right) => left.chain.localeCompare(right.chain))) {
            const account = accounts.get(chain.chain);
            const key = `${registry.policyDigest}\0${chain.chain}\0${account}`;
            const nowMs = this.now();
            const cached = this.cache.lookup(key, nowMs);
            if (cached?.state === "fresh") {
                networks.push(networkResult(chain, account, registry.policyDigest, "fresh", cached.value));
                continue;
            }
            const assets = orderedAssets(chain.assets);
            const read = await this.readNetwork(chain, account, assets);
            requestCount += read.attempts;
            const balances = projectBalances(chain, account, assets, read.result, this.ports[chain.family].source, read.attempts, new Date(this.now()).toISOString());
            const hasUnavailable = balances.some((row) => row.observation.status === "unavailable");
            const ttlMs = hasUnavailable ? cachePolicy.unavailableTtlMs : cachePolicy.availableTtlMs;
            const storedAtMs = this.now(), expiresAtMs = storedAtMs + ttlMs;
            const value = { storedAtMs, expiresAtMs, unavailableCached: hasUnavailable && ttlMs > 0, balances };
            if (ttlMs > 0)
                this.cache.store(key, value);
            networks.push(networkResult(chain, account, registry.policyDigest, cached?.state ?? "miss", value));
        }
        return { datasetDigest: registry.policyDigest, requestCount, networks };
    }
    async readNetwork(chain, account, assets) {
        const port = this.ports[chain.family];
        const request = { mode: mode(chain.family), chain: chain.chain, account,
            assets: assets.map(({ kind, identifier }) => ({ kind, identifier })) };
        for (let attempt = 1;; attempt += 1) {
            let result;
            try {
                result = await port.read(request);
            }
            catch {
                result = { status: "unavailable", reason: "transport", observedAt: new Date(this.now()).toISOString(), block: null, slot: null };
            }
            if (result.status !== "unavailable" || result.httpStatus !== 429 || attempt > MAX_RETRIES) {
                return { attempts: attempt, result };
            }
            await this.wait(attempt === 1 ? 1_000 : 2_000);
        }
    }
}
function portfolioAccounts(value, chains) {
    if (!Array.isArray(value) || value.length !== chains.length)
        invalid("Portfolio accounts must exactly cover the registry networks.");
    const families = new Map(chains.map((chain) => [chain.chain, chain.family]));
    const result = new Map();
    for (const row of value) {
        if (!isPlainRecord(row) || !exactKeys(row, ["chain", "account"]) || typeof row.chain !== "string" ||
            typeof row.account !== "string" || result.has(row.chain))
            invalid("A portfolio account row is invalid or duplicated.");
        const family = families.get(row.chain);
        if (family === undefined)
            invalid("A portfolio account names an unlisted network.");
        result.set(row.chain, canonicalAccount(family, row.account));
    }
    if (result.size !== families.size)
        invalid("Portfolio accounts must exactly cover the registry networks.");
    return result;
}
function cachePolicyContract(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["availableTtlMs", "unavailableTtlMs"]) ||
        !ttl(value.availableTtlMs) || !ttl(value.unavailableTtlMs))
        invalid("The portfolio cache policy is invalid.");
    return value;
}
function ttl(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 300_000;
}
function canonicalAccount(family, value) {
    try {
        if (family === "evm") {
            const account = getAddress(value);
            if (account !== value || account === "0x0000000000000000000000000000000000000000")
                throw new Error("account");
            return account;
        }
        if (family === "solana")
            return solanaAddress(value);
        const account = tronAddress(value);
        if (account !== value)
            throw new Error("account");
        return account;
    }
    catch {
        return invalid("A portfolio account is not canonical for its network family.");
    }
}
function projectBalances(chain, account, assets, result, sourceValue, attempts, fallbackObservedAt) {
    let provenance;
    try {
        const observedAt = instant(result.observedAt), anchor = anchors(chain.family, result.block, result.slot, result.status === "available");
        provenance = { ...anchor, observedAt, source: sourceValue, attempts };
    }
    catch {
        provenance = { block: null, slot: null, observedAt: fallbackObservedAt, source: sourceValue, attempts };
        return assets.map((asset) => ({ chain: chain.chain, family: chain.family, account, asset,
            observation: { status: "unavailable", reason: "protocol", provenance } }));
    }
    if (result.status === "unavailable") {
        const reason = result.httpStatus === 429 ? "rate_limited" : result.reason;
        return assets.map((asset) => ({ chain: chain.chain, family: chain.family, account, asset,
            observation: { status: "unavailable", reason, provenance } }));
    }
    const expected = new Map(assets.map((asset) => [assetKey(asset), asset]));
    const balances = new Map();
    let protocolFailure = false;
    if (!Array.isArray(result.balances) || result.balances.length > assets.length)
        protocolFailure = true;
    else
        for (const row of result.balances) {
            if (!isPlainRecord(row) || !exactKeys(row, ["kind", "identifier", "amountAtomic"]) ||
                (row.kind !== "native" && row.kind !== "token") ||
                (row.kind === "native" ? row.identifier !== null : typeof row.identifier !== "string") ||
                typeof row.amountAtomic !== "string") {
                protocolFailure = true;
                break;
            }
            const key = assetKey(row);
            if (!expected.has(key) || balances.has(key)) {
                protocolFailure = true;
                break;
            }
            try {
                const amount = parseAtomic(row.amountAtomic);
                if (amount > MAX_UINT256)
                    throw new Error("uint256");
                balances.set(key, amount.toString());
            }
            catch {
                protocolFailure = true;
                break;
            }
        }
    return assets.map((asset) => {
        const amount = balances.get(assetKey(asset));
        const observation = protocolFailure ? { status: "unavailable", reason: "protocol", provenance }
            : amount === undefined ? { status: "unavailable", reason: "partial_batch", provenance }
                : { status: "available", amountAtomic: amount, provenance };
        return { chain: chain.chain, family: chain.family, account, asset, observation };
    });
}
function networkResult(chain, account, digest, state, cached) {
    return { chain: chain.chain, family: chain.family, account, datasetDigest: digest,
        cache: { state, storedAt: new Date(cached.storedAtMs).toISOString(), expiresAt: new Date(cached.expiresAtMs).toISOString(),
            unavailableCached: cached.unavailableCached }, balances: structuredClone(cached.balances) };
}
function orderedAssets(assets) {
    return [...assets].sort((left, right) => assetKey(left).localeCompare(assetKey(right)));
}
function assetKey(asset) { return asset.kind === "native" ? "0:native" : `1:${asset.identifier}`; }
function mode(family) {
    return family === "evm" ? "evm_multicall" : family === "solana" ? "solana_native_and_token_accounts" : "tron_native_and_trc20";
}
function anchors(family, block, slot, requiredAnchor) {
    const required = family === "solana" ? slot : block, absent = family === "solana" ? block : slot;
    if (absent !== null || (requiredAnchor && required === null) ||
        (required !== null && !atomicString(required)))
        invalid("A portfolio batch provenance anchor is invalid.");
    return { block: family === "solana" ? null : required, slot: family === "solana" ? required : null };
}
function atomicString(value) {
    if (typeof value !== "string")
        return false;
    try {
        return parseAtomic(value) <= MAX_UINT256;
    }
    catch {
        return false;
    }
}
function instant(value) {
    if (typeof value !== "string")
        invalid("A portfolio batch observation time is invalid.");
    const time = Date.parse(value);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== value)
        invalid("A portfolio batch observation time is invalid.");
    return value;
}
function source(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(value); }
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
//# sourceMappingURL=asset-portfolio-reader.js.map