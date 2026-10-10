import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapQuote } from "../quote.js";
import { assembleJupiterV1, decodeJupiterV1AddressTable } from "./v1-resolver.js";
import { canonicalAddress, SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build, jupiterV1ResponseHash, jupiterV1Lifetime, jupiterV1Instructions } from "./v1-codec.js";
import { routeConfigForMaterial, routeConfigForQuoteBuild } from "./v1-route-config.js";
import { decodeWhirlpoolV2AccountSnapshot } from "./v1-whirlpool-v2-accounts.js";
export const JUPITER_V1_MATERIAL_SCHEMA = "apn.jupiter-v1-resolved-material.v1";
export function checkedJupiterV1QuoteRpcLifetime(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["source", "rpcOriginHash", "contextSlot", "minimumContextSlot", "blockhash", "lastValidBlockHeight"]) ||
        value.source !== "configured_mainnet_rpc_before_quote_freeze" || typeof value.rpcOriginHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.rpcOriginHash) ||
        [value.contextSlot, value.minimumContextSlot, value.lastValidBlockHeight].some(v => typeof v !== "string" || !/^[1-9][0-9]{0,19}$/u.test(v)) ||
        BigInt(value.contextSlot) < BigInt(value.minimumContextSlot) || typeof value.blockhash !== "string")
        corrupt();
    canonicalAddress(value.blockhash);
    return value;
}
/** A saved RPC lifetime cannot silently move to another configured endpoint.
 * Legacy material has no origin evidence; its existing genesis and pin guards remain.
 */
export function assertJupiterV1RpcOrigin(originHash, lifetime) {
    if (lifetime !== undefined && checkedJupiterV1QuoteRpcLifetime(lifetime).rpcOriginHash !== originHash)
        throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter V1 configured RPC differs from the frozen quote origin.", { reason: "jupiter_v1_rpc_origin_mismatch" });
}
export function jupiterV1MaterialDigest(value) { return domainHash(JUPITER_V1_MATERIAL_SCHEMA, canonicalJson(value)); }
export function validateJupiterV1Material(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "genesis", "payer", "quoteResponse", "rawBuildResponse", "quoteResponseHash", "rawBuildResponseHash", "lifetime", ...(Object.hasOwn(value, "quoteRpcLifetime") ? ["quoteRpcLifetime"] : []), "transactionBase64", "transactionHash", "messageBase64", "messageHash", "compiledAccounts", "lookupBindingDigest", "rawInstructions", "semanticAccounts", "addressTables", "programPins", "accountSlot", "currentBlockHeight", "networkFeeLamports", "tokenAccountRentLamports", "maximumNativeExpenseLamports", "materialDigest"]) || value.schemaVersion !== JUPITER_V1_MATERIAL_SCHEMA || value.genesis !== SOLANA_MAINNET_GENESIS || typeof value.materialDigest !== "string")
        corrupt();
    const { materialDigest, ...body } = value;
    if (jupiterV1MaterialDigest(body) !== materialDigest)
        corrupt();
    const typed = value;
    canonicalAddress(typed.payer);
    decodeJupiterV1Quote(typed.quoteResponse);
    decodeJupiterV1Build(typed.rawBuildResponse);
    // Historical unsigned diagnostics contain no executable evidence. They remain
    // readable, but the guard and runtime dispatch require a registered generation.
    const route = typed.programPins.length === 0 ? routeConfigForQuoteBuild(typed.quoteResponse, typed.rawBuildResponse) : routeConfigForMaterial(typed);
    if (jupiterV1ResponseHash(typed.quoteResponse) !== typed.quoteResponseHash || jupiterV1ResponseHash(typed.rawBuildResponse) !== typed.rawBuildResponseHash || sha256(Buffer.from(typed.transactionBase64, "base64")) !== typed.transactionHash || sha256(Buffer.from(typed.messageBase64, "base64")) !== typed.messageHash)
        corrupt();
    for (const row of typed.semanticAccounts) {
        canonicalAddress(row.address);
        if (row.existence === "absent") {
            if (row.owner !== null || row.executable || row.lamports !== "0" || row.dataBase64 !== "")
                corrupt();
        }
        else if (row.existence !== "present" || row.owner === null)
            corrupt();
        else
            canonicalAddress(row.owner);
        if (sha256(Buffer.from(row.dataBase64, "base64")) !== row.dataHash)
            corrupt();
    }
    const uint = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v);
    if (!uint(typed.currentBlockHeight) || !uint(typed.accountSlot) || !uint(typed.tokenAccountRentLamports) || !uint(typed.maximumNativeExpenseLamports) || (typed.networkFeeLamports !== null && !uint(typed.networkFeeLamports)))
        corrupt();
    if (new Set(typed.semanticAccounts.map(a => a.address)).size !== typed.semanticAccounts.length)
        corrupt();
    for (const t of typed.addressTables) {
        if (canonicalJson(decodeJupiterV1AddressTable(t.account)) !== canonicalJson(t) || canonicalJson(typed.semanticAccounts.find(a => a.address === t.account.address)) !== canonicalJson(t.account))
            corrupt();
    }
    if (route.variant === 47) {
        const snapshot = decodeWhirlpoolV2AccountSnapshot(typed.rawBuildResponse, typed.semanticAccounts);
        if (snapshot.roles.payer !== typed.payer)
            corrupt();
    }
    const rpcLifetime = Object.hasOwn(value, "quoteRpcLifetime") ? checkedJupiterV1QuoteRpcLifetime(typed.quoteRpcLifetime) : undefined;
    const lifetime = rpcLifetime === undefined ? jupiterV1Lifetime(typed.rawBuildResponse) : { blockhash: rpcLifetime.blockhash, lastValidBlockHeight: rpcLifetime.lastValidBlockHeight };
    if (canonicalJson(lifetime) !== canonicalJson(typed.lifetime))
        corrupt();
    const assembled = assembleJupiterV1(typed.payer, typed.rawBuildResponse, typed.addressTables, rpcLifetime);
    if (assembled.transactionBase64 !== typed.transactionBase64 || assembled.messageBase64 !== typed.messageBase64 || assembled.lookupBindingDigest !== typed.lookupBindingDigest || canonicalJson(assembled.compiledAccounts) !== canonicalJson(typed.compiledAccounts) || canonicalJson(jupiterV1Instructions(typed.rawBuildResponse)) !== canonicalJson(typed.rawInstructions))
        corrupt();
    if (typed.compiledAccounts.some(a => !typed.semanticAccounts.some(row => row.address === a.address)))
        corrupt();
    return typed;
}
export function assertJupiterV1FreshMaterial(material) {
    validateJupiterV1Material(material);
    if (material.networkFeeLamports === null || BigInt(material.currentBlockHeight) > BigInt(material.lifetime.lastValidBlockHeight))
        throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter V1 exact blockhash expired or its fee is unavailable.", {
            feeUnavailable: material.networkFeeLamports === null,
            blockhashExpired: BigInt(material.currentBlockHeight) > BigInt(material.lifetime.lastValidBlockHeight),
            observedBlockHeight: material.currentBlockHeight,
            lastValidBlockHeight: material.lifetime.lastValidBlockHeight,
        });
}
export function validateJupiterV1PreparedMaterial(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["quote", "approvalCapAtomic", "gasOrEnergy", "execution"]) || value.approvalCapAtomic !== "0")
        corrupt();
    const quote = validateSwapQuote(value.quote, "stored"), execution = validateJupiterV1Material(value.execution);
    if (quote.sourceAsset.chain !== `solana:${SOLANA_MAINNET_GENESIS}` || quote.sourceAsset.kind !== "native" || quote.destinationAsset.kind !== "token" || quote.destinationAsset.identifier !== SOLANA_USDC_MINT || quote.recipient !== execution.payer || quote.slippageBps !== execution.quoteResponse.slippageBps || quote.providerResponseHash !== execution.materialDigest || quote.unsignedTransactionPayloadHash !== sha256(execution.transactionBase64) || quote.account !== execution.payer || quote.inputAmountAtomic !== execution.quoteResponse.inAmount || quote.expectedOutputAtomic !== execution.quoteResponse.outAmount || quote.minimumOutputAtomic !== execution.quoteResponse.otherAmountThreshold)
        corrupt();
    if (canonicalJson(value.gasOrEnergy) !== canonicalJson(jupiterV1GasDisplay(execution)))
        corrupt();
    return value;
}
/** Complete public ProgramData bytes are chunked below the shared store's 1 MiB per-file cap. */
export function jupiterV1GasDisplay(execution) { return { networkFeeLamports: execution.networkFeeLamports ?? "0", tokenAccountRentLamports: execution.tokenAccountRentLamports, maximumNativeExpenseLamports: execution.maximumNativeExpenseLamports }; }
export class SavedJupiterV1MaterialStore extends SecureStateStore {
    initialized;
    async save(value) {
        const checked = validateJupiterV1PreparedMaterial(value);
        await this.ready();
        return await this.withLocks([`jupiter-v1-quote:${checked.quote.quoteHash}`], async () => {
            const existing = await this.readJson(this.path(checked.quote.quoteHash));
            if (existing !== null) {
                const old = await this.readMaterial(existing, checked.quote.quoteHash);
                if (canonicalJson(old) !== canonicalJson(checked))
                    corrupt();
                return checked;
            }
            const serialized = canonicalJson(checked), bytes = Buffer.from(serialized);
            if (bytes.length > 33554432)
                corrupt();
            const chunks = [];
            for (let offset = 0; offset < bytes.length; offset += 262144) {
                const chunk = bytes.subarray(offset, offset + 262144), hash = sha256(chunk), path = `jupiter-v1-quotes/chunks/${hash}.json`;
                const prior = await this.readJson(path);
                const content = { schemaVersion: "apn.jupiter-v1-chunk.v1", hash, dataBase64: chunk.toString("base64") };
                if (prior === null)
                    await this.writeJson(path, content, true);
                else if (canonicalJson(prior) !== canonicalJson(content))
                    corrupt();
                chunks.push({ hash, length: chunk.length });
            }
            await this.writeJson(this.path(checked.quote.quoteHash), { schemaVersion: "apn.jupiter-v1-material-manifest.v1", quoteHash: checked.quote.quoteHash, serializedHash: sha256(bytes), length: bytes.length, chunks }, true);
            return checked;
        });
    }
    async load(hash) { stateIdentifier(hash, "Jupiter V1 quote hash"); await this.ready(); const manifest = await this.readJson(this.path(hash)); return manifest === null ? null : await this.readMaterial(manifest, hash); }
    async readMaterial(value, hash) {
        if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "quoteHash", "serializedHash", "length", "chunks"]) || value.schemaVersion !== "apn.jupiter-v1-material-manifest.v1" || value.quoteHash !== hash || typeof value.serializedHash !== "string" || !Number.isSafeInteger(value.length) || Number(value.length) < 1 || Number(value.length) > 33554432 || !Array.isArray(value.chunks) || value.chunks.length < 1 || value.chunks.length > 128)
            corrupt();
        const chunks = [];
        for (const entry of value.chunks) {
            if (!isPlainRecord(entry) || !exactKeys(entry, ["hash", "length"]) || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/u.test(entry.hash) || !Number.isSafeInteger(entry.length) || Number(entry.length) < 1 || Number(entry.length) > 262144)
                corrupt();
            const raw = await this.readJson(`jupiter-v1-quotes/chunks/${entry.hash}.json`);
            if (!isPlainRecord(raw) || !exactKeys(raw, ["schemaVersion", "hash", "dataBase64"]) || raw.schemaVersion !== "apn.jupiter-v1-chunk.v1" || raw.hash !== entry.hash || typeof raw.dataBase64 !== "string")
                corrupt();
            const bytes = Buffer.from(raw.dataBase64, "base64");
            if (bytes.toString("base64") !== raw.dataBase64 || bytes.length !== entry.length || sha256(bytes) !== entry.hash)
                corrupt();
            chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== value.length || sha256(bytes) !== value.serializedHash)
            corrupt();
        let decoded;
        try {
            decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        }
        catch {
            corrupt();
        }
        const result = validateJupiterV1PreparedMaterial(decoded);
        if (result.quote.quoteHash !== hash)
            corrupt();
        return result;
    }
    path(hash) { return `jupiter-v1-quotes/${hash}.json`; }
    async initializeStorage() { await super.initialize(); }
    async ready() { this.initialized ??= (async () => { await this.initializeStorage(); await this.ensureDirectory("jupiter-v1-quotes"); await this.ensureDirectory("jupiter-v1-quotes/chunks"); })(); await this.initialized; }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Jupiter V1 material integrity or binding is invalid."); }
//# sourceMappingURL=v1-material.js.map