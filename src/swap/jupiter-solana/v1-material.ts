import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapQuote, type SwapQuoteSnapshot } from "../quote.js";
import type { GuardedSwapPreparedMaterial } from "../runtime.js";
import { assembleJupiterV1, decodeJupiterV1AddressTable } from "./v1-resolver.js";
import { canonicalAddress, SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build, jupiterV1ResponseHash, jupiterV1Lifetime, jupiterV1Instructions, type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse, type JupiterV1RawInstruction } from "./v1-codec.js";
import { routeConfigForMaterial, routeConfigForQuoteBuild } from "./v1-route-config.js";
import { decodeWhirlpoolV2AccountSnapshot } from "./v1-whirlpool-v2-accounts.js";
export const JUPITER_V1_MATERIAL_SCHEMA = "apn.jupiter-v1-resolved-material.v1" as const;
export interface JupiterV1SemanticAccount {
    readonly address: string;
    readonly existence: "present" | "absent";
    readonly owner: string | null;
    readonly executable: boolean;
    readonly lamports: string;
    readonly dataBase64: string;
    readonly dataHash: string;
    readonly slot: string;
}
export interface JupiterV1AddressTable {
    readonly account: JupiterV1SemanticAccount;
    readonly addresses: readonly string[];
    readonly deactivationSlot: string;
    readonly lastExtendedSlot: string;
}
export interface JupiterV1RuntimeProgramPin {
    readonly programId: string;
    readonly loader: string;
    readonly programDataAddress: string | null;
    readonly deploymentSlot: string | null;
    readonly upgradeAuthority: string | null;
    readonly accountHash: string;
    readonly programDataHash: string | null;
    readonly storedPayloadHash: string;
    readonly provenance: "runtime_bytes_only";
}
export interface JupiterV1CompiledAccount {
    readonly address: string;
    readonly signer: boolean;
    readonly writable: boolean;
    readonly source: "static" | "lookup";
}
export interface JupiterV1ResolvedMaterial {
    readonly schemaVersion: typeof JUPITER_V1_MATERIAL_SCHEMA;
    readonly genesis: typeof SOLANA_MAINNET_GENESIS;
    readonly payer: string;
    readonly quoteResponse: JupiterV1QuoteResponse;
    readonly rawBuildResponse: JupiterV1RawBuildResponse;
    readonly quoteResponseHash: string;
    readonly rawBuildResponseHash: string;
    readonly lifetime: {
        readonly blockhash: string;
        readonly lastValidBlockHeight: string;
    };
    /** Obtained before quote freeze; the original official build stays untouched. */
    readonly quoteRpcLifetime?: JupiterV1QuoteRpcLifetime;
    readonly transactionBase64: string;
    readonly transactionHash: string;
    readonly messageBase64: string;
    readonly messageHash: string;
    readonly rawInstructions: readonly JupiterV1RawInstruction[];
    readonly compiledAccounts: readonly JupiterV1CompiledAccount[];
    readonly lookupBindingDigest: string;
    readonly semanticAccounts: readonly JupiterV1SemanticAccount[];
    readonly addressTables: readonly JupiterV1AddressTable[];
    readonly programPins: readonly JupiterV1RuntimeProgramPin[];
    readonly accountSlot: string;
    readonly currentBlockHeight: string;
    readonly networkFeeLamports: string | null;
    readonly tokenAccountRentLamports: string;
    readonly maximumNativeExpenseLamports: string;
    readonly materialDigest: string;
}
export interface JupiterV1QuoteRpcLifetime {
    readonly source: "configured_mainnet_rpc_before_quote_freeze";
    readonly rpcOriginHash: string;
    readonly contextSlot: string;
    readonly minimumContextSlot: string;
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
}
export function checkedJupiterV1QuoteRpcLifetime(value: unknown): JupiterV1QuoteRpcLifetime {
    if (!isPlainRecord(value) || !exactKeys(value, ["source", "rpcOriginHash", "contextSlot", "minimumContextSlot", "blockhash", "lastValidBlockHeight"]) ||
        value.source !== "configured_mainnet_rpc_before_quote_freeze" || typeof value.rpcOriginHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.rpcOriginHash) ||
        [value.contextSlot, value.minimumContextSlot, value.lastValidBlockHeight].some(v => typeof v !== "string" || !/^[1-9][0-9]{0,19}$/u.test(v)) ||
        BigInt(value.contextSlot as string) < BigInt(value.minimumContextSlot as string) || typeof value.blockhash !== "string") corrupt();
    canonicalAddress(value.blockhash);
    return value as unknown as JupiterV1QuoteRpcLifetime;
}
export interface JupiterV1PreparedMaterial extends GuardedSwapPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: "0";
    readonly execution: JupiterV1ResolvedMaterial;
}
export function jupiterV1MaterialDigest(value: Omit<JupiterV1ResolvedMaterial, "materialDigest">): string { return domainHash(JUPITER_V1_MATERIAL_SCHEMA, canonicalJson(value)); }
export function validateJupiterV1Material(value: unknown): JupiterV1ResolvedMaterial {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "genesis", "payer", "quoteResponse", "rawBuildResponse", "quoteResponseHash", "rawBuildResponseHash", "lifetime", ...(Object.hasOwn(value, "quoteRpcLifetime") ? ["quoteRpcLifetime"] : []), "transactionBase64", "transactionHash", "messageBase64", "messageHash", "compiledAccounts", "lookupBindingDigest", "rawInstructions", "semanticAccounts", "addressTables", "programPins", "accountSlot", "currentBlockHeight", "networkFeeLamports", "tokenAccountRentLamports", "maximumNativeExpenseLamports", "materialDigest"]) || value.schemaVersion !== JUPITER_V1_MATERIAL_SCHEMA || value.genesis !== SOLANA_MAINNET_GENESIS || typeof value.materialDigest !== "string")
        corrupt();
    const { materialDigest, ...body } = value;
    if (jupiterV1MaterialDigest(body as unknown as Omit<JupiterV1ResolvedMaterial, "materialDigest">) !== materialDigest)
        corrupt();
    const typed = value as unknown as JupiterV1ResolvedMaterial;
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
    const uint = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v);
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
        if (snapshot.roles.payer !== typed.payer) corrupt();
    }
    const rpcLifetime = Object.hasOwn(value, "quoteRpcLifetime") ? checkedJupiterV1QuoteRpcLifetime(typed.quoteRpcLifetime) : undefined;
    const lifetime = rpcLifetime === undefined ? jupiterV1Lifetime(typed.rawBuildResponse) : { blockhash: rpcLifetime.blockhash, lastValidBlockHeight: rpcLifetime.lastValidBlockHeight };
    if (canonicalJson(lifetime) !== canonicalJson(typed.lifetime)) corrupt();
    const assembled = assembleJupiterV1(typed.payer, typed.rawBuildResponse, typed.addressTables, rpcLifetime);
    if (assembled.transactionBase64 !== typed.transactionBase64 || assembled.messageBase64 !== typed.messageBase64 || assembled.lookupBindingDigest !== typed.lookupBindingDigest || canonicalJson(assembled.compiledAccounts) !== canonicalJson(typed.compiledAccounts) || canonicalJson(jupiterV1Instructions(typed.rawBuildResponse)) !== canonicalJson(typed.rawInstructions))
        corrupt();
    if (typed.compiledAccounts.some(a => !typed.semanticAccounts.some(row => row.address === a.address)))
        corrupt();
    return typed;
}
export function assertJupiterV1FreshMaterial(material: JupiterV1ResolvedMaterial): void {
    validateJupiterV1Material(material);
    if (material.networkFeeLamports === null || BigInt(material.currentBlockHeight) > BigInt(material.lifetime.lastValidBlockHeight))
        throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter V1 exact blockhash expired or its fee is unavailable.");
}
export function validateJupiterV1PreparedMaterial(value: unknown): JupiterV1PreparedMaterial {
    if (!isPlainRecord(value) || !exactKeys(value, ["quote", "approvalCapAtomic", "gasOrEnergy", "execution"]) || value.approvalCapAtomic !== "0")
        corrupt();
    const quote = validateSwapQuote(value.quote, "stored"), execution = validateJupiterV1Material(value.execution);
    if (quote.sourceAsset.chain!==`solana:${SOLANA_MAINNET_GENESIS}`||quote.sourceAsset.kind!=="native"||quote.destinationAsset.kind!=="token"||quote.destinationAsset.identifier!==SOLANA_USDC_MINT||quote.recipient!==execution.payer||quote.slippageBps!==execution.quoteResponse.slippageBps||quote.providerResponseHash !== execution.materialDigest || quote.unsignedTransactionPayloadHash !== sha256(execution.transactionBase64) || quote.account !== execution.payer || quote.inputAmountAtomic !== execution.quoteResponse.inAmount || quote.expectedOutputAtomic !== execution.quoteResponse.outAmount || quote.minimumOutputAtomic !== execution.quoteResponse.otherAmountThreshold)
        corrupt();
    if(canonicalJson(value.gasOrEnergy)!==canonicalJson(jupiterV1GasDisplay(execution)))corrupt();
    return value as unknown as JupiterV1PreparedMaterial;
}
/** Complete public ProgramData bytes are chunked below the shared store's 1 MiB per-file cap. */
export function jupiterV1GasDisplay(execution:JupiterV1ResolvedMaterial):Readonly<Record<string,string>>{return {networkFeeLamports:execution.networkFeeLamports??"0",tokenAccountRentLamports:execution.tokenAccountRentLamports,maximumNativeExpenseLamports:execution.maximumNativeExpenseLamports};}
export class SavedJupiterV1MaterialStore extends SecureStateStore {
    private initialized: Promise<void> | undefined;
    async save(value: JupiterV1PreparedMaterial): Promise<JupiterV1PreparedMaterial> {
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
            const chunks: {
                hash: string;
                length: number;
            }[] = [];
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
    async load(hash: string): Promise<JupiterV1PreparedMaterial | null> { stateIdentifier(hash, "Jupiter V1 quote hash"); await this.ready(); const manifest = await this.readJson(this.path(hash)); return manifest === null ? null : await this.readMaterial(manifest, hash); }
    private async readMaterial(value: unknown, hash: string): Promise<JupiterV1PreparedMaterial> {
        if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "quoteHash", "serializedHash", "length", "chunks"]) || value.schemaVersion !== "apn.jupiter-v1-material-manifest.v1" || value.quoteHash !== hash || typeof value.serializedHash !== "string" || !Number.isSafeInteger(value.length) || Number(value.length) < 1 || Number(value.length) > 33554432 || !Array.isArray(value.chunks) || value.chunks.length < 1 || value.chunks.length > 128)
            corrupt();
        const chunks: Buffer[] = [];
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
        let decoded: unknown;
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
    private path(hash: string): string { return `jupiter-v1-quotes/${hash}.json`; }
  protected async initializeStorage(): Promise<void> { await super.initialize(); }
    private async ready(): Promise<void> { this.initialized ??= (async () => { await this.initializeStorage(); await this.ensureDirectory("jupiter-v1-quotes"); await this.ensureDirectory("jupiter-v1-quotes/chunks"); })(); await this.initialized; }
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Jupiter V1 material integrity or binding is invalid."); }
