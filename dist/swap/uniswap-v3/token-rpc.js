import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { BridgeHttps } from "../../lifi/https.js";
import { bridgeRpcCall, RpcProviderScheduler, RpcReadSession } from "../../lifi/rpc.js";
import { submitDirect } from "../../lifi/rpc-support.js";
import { bridgeArchiveEndpoint } from "../../lifi/rpc-archive.js";
import { tokenPrimaryCandidates } from "./token-rpc-pool.js";
export async function tokenBatch(call, route, items) {
    if (items.length < 1 || items.length > 3)
        throw new Error("Token RPC batch must contain one to three items.");
    if (call.batch !== undefined)
        return await call.batch(route, items);
    return await Promise.all(items.map((item) => call(item.method, item.params)));
}
export function tokenChain(value) {
    if (evmRpcQuantity(value) !== 1n)
        throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token RPC route requires Ethereum chain 1.");
    return value;
}
export function tokenQuantity(value) { evmRpcQuantity(value); return value; }
export function tokenHex(bytes) { return (value) => { evmRpcHex(value, bytes); return value; }; }
export function tokenBlock(value) { const record = evmRpcRecord(value); evmRpcQuantity(record.number); evmRpcHex(record.hash, 32); return value; }
export function createTokenRpc(input) {
    if (input.environment.APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS === undefined || input.environment.APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS === "") {
        return createLegacyTokenRpc(input);
    }
    let candidateRows;
    const candidates = () => candidateRows ??= tokenPrimaryCandidates(input.environment);
    const scheduler = new RpcProviderScheduler({
        coordinate: async (family, work) => {
            const familyHash = sha256(`rpc-provider-family\0${family}`);
            await input.state.initialize();
            return await input.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await input.state.loadRpcProviderPacing(familyHash), async (value) => await input.state.writeRpcProviderPacing(familyHash, value), await input.state.loadRpcProviderCooldown(familyHash), async (value) => await input.state.writeRpcProviderCooldown(familyHash, value)));
        },
    }, input.pacingNow, "reject", "transient");
    let initialized;
    const resolve = () => initialized ??= (() => {
        const session = new RpcReadSession({ maxLogicalItems: input.maxLogicalItems ?? input.maxHttpRequests * 3,
            maxHttpRequests: input.maxHttpRequests, maxHttpAttempts: input.maxHttpRequests, maxReadAttempts: 1,
            deadlineMs: input.deadlineMs, now: input.now, ...(input.wait === undefined ? {} : { wait: input.wait }), providerScheduler: scheduler });
        const baseTransport = input.transport ?? new BridgeHttps(undefined, undefined, 2_500), transport = { request: async (...args) => {
                const response = await baseTransport.request(...args);
                if (response.status === 200 && capabilityResponse(response.body))
                    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap token primary does not support bounded JSON-RPC batches.", { reason: "token_primary_batch_unsupported" });
                return response.status === 200 && credentialResponse(response.body) ? { ...response, status: 403, body: "" } : response;
            } }, descriptors = candidates().map((candidate) => bridgeRpcCall(1, { ...input.environment, APN_ETHEREUM_RPC_URL: candidate.url.toString() }, { transport }));
        return { session, descriptors, archive: bridgeArchiveEndpoint(1, input.environment) !== null };
    })();
    let effects = 0, selected = null;
    const attempts = [], tried = new Set();
    const primaryBlocks = new PrimaryBlockHashes(), archiveVerified = new Set();
    const call = (async (method, params) => {
        if (selected === null)
            throw new ApnError("APN_RPC_CONFIG", "Uniswap token primary provider is not semantically selected.", { reason: "token_primary_not_selected" });
        const descriptor = resolve().descriptors[selected];
        if (method === "eth_sendRawTransaction")
            return await submitDirect(method, params, async () => await resolve().session.externalAttempt(descriptor.origin, async () => { effects += 1; return await descriptor.attempt(method, params); }));
        return await descriptor.sessionCall(resolve().session)(method, resolve().archive ? params : pinnedToHash(method, params, primaryBlocks));
    });
    Object.defineProperties(call, {
        batch: { value: async (requested, items) => {
                const index = selected ?? 0, descriptor = resolve().descriptors[index], route = servedTokenRoute(requested, descriptor, resolve().archive);
                // The primary stands in for an unconfigured archive or receipt reader only once the pool has selected it: such a batch
                // never runs the selection, which could quarantine a candidate on a sub-error and send the batch to the next one.
                if (route === "primary" && requested !== "primary" && selected === null)
                    throw new ApnError("APN_RPC_CONFIG", "Uniswap token primary provider is not semantically selected.", { reason: "token_primary_not_selected", rpcRoute: requested });
                if (route === "primary")
                    return await primary(items);
                if (route === "archive")
                    await verifyArchive(items);
                return await descriptor.sessionBatchCall(resolve().session)(items, route);
            } },
        telemetry: { value: () => initialized?.session.telemetry() ?? null },
        effectAttempts: { value: () => effects },
        reserveEffectSlot: { value: () => resolve().session.reserveExternalAttempt() },
        primaryPoolTelemetry: { value: () => ({ schemaVersion: "apn.uniswap-token-primary-pool-telemetry.v1",
                configuredCandidates: candidates().length, selectedProviderId: selected === null ? null : candidates()[selected].id, attempts: [...attempts] }) },
        primaryPoolEnabled: { value: () => true },
        primaryPoolSize: { value: () => candidates().length },
        selectedPrimaryProviderId: { value: () => selected === null ? null : candidates()[selected].id },
        bindPrimaryProvider: { value: async (providerId) => { await bindProvider(providerId); } },
        archiveConfigured: { value: () => resolve().archive },
    });
    return call;
    async function primary(items) {
        if (selected !== null)
            return await selectedBatch(items);
        await input.state.initialize();
        for (let index = 0; index < candidates().length; index += 1) {
            if (tried.has(index))
                continue;
            tried.add(index);
            // Pool code always acquires probe before the scheduler's provider-family lock. No path acquires them in reverse.
            const result = await input.state.withLocks([probeLock(index)], async () => {
                try {
                    const values = await resolve().descriptors[index].sessionBatchCall(resolve().session)(pinnedItems(items, primaryBlocks), "primary");
                    rememberBlocks(items, values);
                    selected = index;
                    attempts.push({ providerId: candidates()[index].id, outcome: "selected", reason: null });
                    return { ok: true, values };
                }
                catch (error) {
                    const reason = failureReason(error);
                    if (reason === null)
                        throw error;
                    attempts.push({ providerId: candidates()[index].id,
                        outcome: reason === "cooldown" ? "cooldown_skipped" : "failed", reason });
                    if (reason !== "cooldown")
                        await quarantine(index, reason);
                    if (reason === "rate_limited")
                        throw error;
                    return { ok: false };
                }
            });
            if (result.ok)
                return result.values;
        }
        throw new ApnError("APN_PROVIDER_UNAVAILABLE", "No configured Uniswap token primary provider passed semantic validation.", { reason: "token_primary_pool_exhausted", attemptedProviders: attempts.length.toString() });
    }
    async function selectedBatch(items) {
        const values = await resolve().descriptors[selected].sessionBatchCall(resolve().session)(pinnedItems(items, primaryBlocks), "primary");
        rememberBlocks(items, values);
        return values;
    }
    function rememberBlocks(items, values) { primaryBlocks.remember(items, values); }
    async function verifyArchive(items) {
        const tags = [...new Set(items.map(archiveTag).filter((tag) => tag !== null && !archiveVerified.has(tag)))];
        if (tags.length === 0)
            return;
        if (tags.length > 2 || tags.some((tag) => primaryBlocks.pinned(tag) === undefined))
            throw new ApnError("APN_RPC_CONFIG", "Uniswap token archive read lacks a primary block anchor.", { reason: "token_archive_block_unanchored" });
        const checks = [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
            ...tags.map((tag) => ({ method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: tokenBlock }))];
        const values = await resolve().descriptors[0].sessionBatchCall(resolve().session)(checks, "archive");
        tokenChain(values[0]);
        for (let index = 0; index < tags.length; index += 1) {
            const block = evmRpcRecord(values[index + 1]), observed = evmRpcHex(block.hash, 32);
            if (observed !== primaryBlocks.pinned(tags[index]))
                throw new ApnError("APN_RPC_PROTOCOL", "Uniswap token archive block identity mismatched primary.", { reason: "token_archive_block_mismatch" });
            archiveVerified.add(tags[index]);
        }
    }
    async function quarantine(index, reason) {
        const candidate = candidates()[index], duration = reason === "rate_limited" ? 30_000 : 5_000, now = input.pacingNow?.() ?? Date.now();
        await input.state.initialize();
        await input.state.withLocks([`rpc-provider-family:${candidate.familyHash}`], async () => {
            const current = await input.state.loadRpcProviderCooldown(candidate.familyHash);
            await input.state.writeRpcProviderCooldown(candidate.familyHash, Math.max(current ?? 0, now + duration));
        });
    }
    async function bindProvider(providerId) {
        if (providerId === null || !/^[a-f0-9]{64}$/u.test(providerId))
            throw new ApnError("APN_OPERATION_BLOCKED", "Signed Uniswap token effect has no valid primary provider binding.", { reason: "uniswap_token_provider_binding_missing" });
        const index = candidates().findIndex((candidate) => candidate.id === providerId);
        if (index < 0)
            throw new ApnError("APN_OPERATION_BLOCKED", "Signed Uniswap token effect provider is unavailable.", { reason: "uniswap_token_provider_binding_unavailable" });
        if (selected !== null && selected !== index)
            throw new ApnError("APN_OPERATION_BLOCKED", "Signed Uniswap token effect provider changed.", { reason: "uniswap_token_provider_binding_changed" });
        await input.state.initialize();
        await input.state.withLocks([probeLock(index)], async () => {
            await input.state.withLocks([`rpc-provider-family:${candidates()[index].familyHash}`], async () => {
                const cooldown = await input.state.loadRpcProviderCooldown(candidates()[index].familyHash), now = input.pacingNow?.() ?? Date.now();
                if (cooldown !== null && cooldown > now)
                    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Signed Uniswap token effect provider is cooling down.", { reason: "uniswap_token_bound_provider_cooldown" });
                if (selected === null) {
                    selected = index;
                    tried.add(index);
                    attempts.push({ providerId, outcome: "recovery_bound", reason: null });
                }
            });
        });
    }
    function probeLock(index) { return `uniswap-token-primary-probe:${candidates()[index].familyHash}`; }
}
function createLegacyTokenRpc(input) {
    const scheduler = new RpcProviderScheduler({ coordinate: async (family, work) => {
            const familyHash = sha256(`rpc-provider-family\0${family}`);
            await input.state.initialize();
            return await input.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await input.state.loadRpcProviderPacing(familyHash), async (value) => await input.state.writeRpcProviderPacing(familyHash, value), await input.state.loadRpcProviderCooldown(familyHash), async (value) => await input.state.writeRpcProviderCooldown(familyHash, value)));
        } }, input.pacingNow);
    let initialized;
    const resolve = () => initialized ??= (() => {
        const session = new RpcReadSession({ maxLogicalItems: input.maxLogicalItems ?? 96,
            maxHttpRequests: input.maxHttpRequests, maxHttpAttempts: input.maxHttpRequests, maxReadAttempts: 1, deadlineMs: input.deadlineMs,
            now: input.now, ...(input.wait === undefined ? {} : { wait: input.wait }), providerScheduler: scheduler });
        const descriptor = bridgeRpcCall(1, input.environment, { transport: input.transport ?? new BridgeHttps(undefined, undefined, 2_500) });
        return { session, descriptor, read: descriptor.sessionCall(session), batch: descriptor.sessionBatchCall(session),
            archive: bridgeArchiveEndpoint(1, input.environment) !== null };
    })();
    let effects = 0, archiveVerified = false;
    const primaryBlocks = new PrimaryBlockHashes();
    const call = (async (method, params) => {
        if (method === "eth_sendRawTransaction")
            return await submitDirect(method, params, async () => await resolve().session.externalAttempt(resolve().descriptor.origin, async () => { effects += 1; return await resolve().descriptor.attempt(method, params); }));
        // Without an archive the primary serves every pinned scalar read; with one, a pinned read is the archive's.
        return await resolve().read(method, resolve().archive ? params : pinnedToHash(method, params, primaryBlocks));
    });
    Object.defineProperties(call, { batch: { value: async (requested, items) => {
                const route = servedTokenRoute(requested, resolve().descriptor, resolve().archive);
                if (route === "primary") {
                    const values = await resolve().batch(pinnedItems(items, primaryBlocks), route);
                    primaryBlocks.remember(items, values);
                    return values;
                }
                if (route === "archive" && !archiveVerified) {
                    const identity = items.findIndex((item) => item.method === "eth_chainId");
                    if (identity >= 0) {
                        const values = await resolve().batch(items, route);
                        tokenChain(values[identity]);
                        archiveVerified = true;
                        return values;
                    }
                    await resolve().batch([{ method: "eth_chainId", params: [], cachePolicy: "none", decoder: tokenChain }], route);
                    archiveVerified = true;
                }
                return await resolve().batch(items, route);
            } }, telemetry: { value: () => initialized?.session.telemetry() ?? null },
        effectAttempts: { value: () => effects }, reserveEffectSlot: { value: () => resolve().session.reserveExternalAttempt() },
        primaryPoolEnabled: { value: () => false }, primaryPoolSize: { value: () => 1 },
        selectedPrimaryProviderId: { value: () => null }, bindPrimaryProvider: { value: async (providerId) => {
                if (providerId !== null)
                    throw new ApnError("APN_OPERATION_BLOCKED", "Scalar Uniswap token RPC cannot restore a pooled provider binding.", { reason: "uniswap_token_provider_binding_changed" });
            } }, archiveConfigured: { value: () => resolve().archive } });
    return call;
}
/**
 * The endpoint that serves one lane batch. The archive and the receipt reader are optional (docs/uniswap.md, Setup): a
 * configured archive serves the state pinned to an exact block, and a configured receipt reader (else that archive) serves
 * receipts. Without one the primary serves them, as it serves the lane's scalar reads; that works for recent blocks on
 * any full node. The route follows the configuration only: a batch is never sent to a second endpoint after a failure.
 */
function servedTokenRoute(route, descriptor, archive) {
    if (route === "archive")
        return archive ? "archive" : "primary";
    if (route === "receipt")
        return descriptor.receipts.reader || descriptor.receipts.fallback ? "receipt" : "primary";
    return route;
}
/** The EIP-1898 block parameter of each state read that takes one. EIP-1898 defines none for eth_estimateGas. */
const PINNABLE_STATE_READS = { eth_call: 1, eth_getCode: 1, eth_getStorageAt: 2, eth_getBalance: 1, eth_getTransactionCount: 1 };
/**
 * The blocks this command read from the primary by number. A block read directly keeps the first hash the primary
 * answered for it; a later block's parent hash names the block before it only while that number was never read directly.
 * Two different hashes for one number, from any two answers, leave it conflicted: a read pinned there refuses instead of
 * choosing either, so state is never read at a block other than the one the command checked.
 */
class PrimaryBlockHashes {
    rows = new Map();
    remember(items, values) {
        for (let index = 0; index < items.length; index += 1)
            if (items[index].method === "eth_getBlockByNumber") {
                let number, hash, parent;
                try {
                    const block = evmRpcRecord(values[index]);
                    number = evmRpcQuantity(block.number);
                    hash = evmRpcHex(block.hash, 32);
                    parent = typeof block.parentHash === "string" ? evmRpcHex(block.parentHash, 32) : undefined;
                }
                catch {
                    continue; /* The caller decoder owns the required block shape. */
                }
                this.record(`0x${number.toString(16)}`, hash, true);
                if (number > 0n && parent !== undefined)
                    this.record(`0x${(number - 1n).toString(16)}`, parent, false);
            }
    }
    /** The hash reads at this block number are pinned to; undefined for a number this command never read. */
    pinned(tag) {
        const row = this.rows.get(tag);
        if (row === "conflict")
            throw new ApnError("APN_RPC_PROTOCOL", "The primary RPC answered two different hashes for a block this command reads state at; nothing is read there.", { reason: "token_primary_block_hash_conflict", blockNumber: BigInt(tag).toString() });
        return row?.hash;
    }
    record(tag, hash, direct) {
        const prior = this.rows.get(tag);
        if (prior === undefined)
            this.rows.set(tag, { hash, direct });
        else if (prior !== "conflict" && prior.hash !== hash)
            this.rows.set(tag, "conflict");
        else if (prior !== "conflict" && direct && !prior.direct)
            this.rows.set(tag, { hash, direct });
    }
}
/**
 * A state read the primary serves at a block number this command read from it goes out pinned to that block's hash
 * (EIP-1898, requireCanonical), as the custody's allowance read already is: a backend on another branch refuses it
 * instead of answering that branch's state. The request count is unchanged; a number the command never read stays as it is.
 */
function pinnedToHash(method, params, blocks) {
    const index = PINNABLE_STATE_READS[method], tag = index === undefined || params.length !== index + 1 ? undefined : params[index];
    const hash = typeof tag === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(tag) ? blocks.pinned(tag) : undefined;
    return hash === undefined ? params : [...params.slice(0, index), { blockHash: hash, requireCanonical: true }];
}
function pinnedItems(items, blocks) {
    return items.map((item) => { const params = pinnedToHash(item.method, item.params, blocks); return params === item.params ? item : { ...item, params }; });
}
function archiveTag(item) {
    const index = item.method === "eth_getStorageAt" ? 2 : ["eth_call", "eth_getCode"].includes(item.method) ? 1 : null;
    if (index === null)
        return null;
    const value = item.params[index];
    return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value) ? value.toLowerCase() : null;
}
function failureReason(error) {
    if (!(error instanceof ApnError))
        return null;
    if (error.code === "APN_PROVIDER_UNAVAILABLE" && error.details?.reason === "rpc_provider_cooldown")
        return "cooldown";
    if (error.code === "APN_RPC_RATE_LIMITED")
        return "rate_limited";
    if (error.code === "APN_CHAIN_MISMATCH")
        return "wrong_chain";
    if (error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE")
        return "capability";
    if (error.code === "APN_RPC_AMBIGUOUS")
        return "deadline";
    if (error.code === "APN_RPC_PROTOCOL") {
        const status = Number(error.details?.httpStatus);
        if (status === 401 || status === 403)
            return "authentication";
        if (status >= 500 && status <= 599)
            return "http_5xx";
        return "malformed";
    }
    return null;
}
function credentialResponse(body) {
    if (body.length < 2 || body.length > 1_048_576)
        return false;
    try {
        const value = JSON.parse(body), rows = Array.isArray(value) ? value : [value];
        return rows.some((row) => {
            if (typeof row !== "object" || row === null || Array.isArray(row))
                return false;
            const error = row.error;
            if (typeof error !== "object" || error === null || Array.isArray(error))
                return false;
            const message = error.message;
            return typeof message === "string" && ["api key", "apikey", "unauthorized", "authentication", "access denied"]
                .some((part) => message.toLowerCase().includes(part));
        });
    }
    catch {
        return false;
    }
}
function capabilityResponse(body) {
    if (body.length < 2 || body.length > 1_048_576)
        return false;
    try {
        const value = JSON.parse(body), rows = Array.isArray(value) ? value : [value];
        return rows.some((row) => {
            if (typeof row !== "object" || row === null || Array.isArray(row))
                return false;
            const error = row.error;
            if (typeof error !== "object" || error === null || Array.isArray(error))
                return false;
            const message = error.message;
            return typeof message === "string" && ["batch requests are not supported", "batch requests not supported", "batch unsupported"]
                .includes(message.trim().toLowerCase());
        });
    }
    catch {
        return false;
    }
}
/**
 * The never-lands batches through the token lane's own pool and budget: everything but the receipt in one primary batch
 * (one node answers the finalized nonce, the transaction lookup and the index probe together; the deciding batch carries
 * no chain id, so it fits the three-item bound), the receipt on its route, as the observer reads it (the receipt route's
 * shape is exactly chain id + receipt).
 */
export function tokenFinalizedBatch(call) {
    const item = (read) => ({ method: read.method, params: read.params,
        cachePolicy: read.method === "eth_chainId" ? "immutable" : "none", decoder: (row) => row });
    return async (calls) => {
        const receipt = calls.find((read) => read.method === "eth_getTransactionReceipt"), primary = calls.filter((read) => read !== receipt);
        const [rows, receiptRows] = await Promise.all([tokenBatch(call, "primary", primary.map(item)), receipt === undefined ? [] :
                tokenBatch(call, "receipt", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain }, item(receipt)])]);
        let next = 0;
        return calls.map((read) => read === receipt ? receiptRows[1] : rows[next++]);
    };
}
//# sourceMappingURL=token-rpc.js.map