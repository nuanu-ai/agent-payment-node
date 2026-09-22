import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { BridgeHttps } from "../../lifi/https.js";
import { bridgeRpcCall, RpcProviderScheduler, RpcReadSession } from "../../lifi/rpc.js";
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
export function tokenNullableRecord(value) { if (value !== null)
    evmRpcRecord(value); return value; }
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
                return response.status === 200 && credentialResponse(response.body)
                    ? { ...response, status: 403, body: "" } : response;
            } }, descriptors = candidates().map((candidate) => bridgeRpcCall(1, { ...input.environment, APN_ETHEREUM_RPC_URL: candidate.url.toString() }, { transport }));
        return { session, descriptors };
    })();
    let effects = 0, selected = null;
    const attempts = [], tried = new Set();
    const primaryBlocks = new Map(), archiveVerified = new Set();
    const call = (async (method, params) => {
        if (selected === null)
            throw new ApnError("APN_RPC_CONFIG", "Uniswap token primary provider is not semantically selected.", { reason: "token_primary_not_selected" });
        const descriptor = resolve().descriptors[selected];
        if (method === "eth_sendRawTransaction") {
            effects += 1;
            return await descriptor.call(method, params);
        }
        return await descriptor.sessionCall(resolve().session)(method, params);
    });
    Object.defineProperties(call, {
        batch: { value: async (route, items) => {
                if (route === "primary")
                    return await primary(items);
                if (route === "archive")
                    await verifyArchive(items);
                const index = selected ?? 0, descriptor = resolve().descriptors[index];
                return await descriptor.sessionBatchCall(resolve().session)(items, route);
            } },
        telemetry: { value: () => initialized?.session.telemetry() ?? null },
        effectAttempts: { value: () => effects },
        primaryPoolTelemetry: { value: () => ({ schemaVersion: "apn.uniswap-token-primary-pool-telemetry.v1",
                configuredCandidates: candidates().length, selectedProviderId: selected === null ? null : candidates()[selected].id, attempts: [...attempts] }) },
        primaryPoolEnabled: { value: () => true },
        primaryPoolSize: { value: () => candidates().length },
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
            try {
                return await input.state.withLocks([`uniswap-token-primary-probe:${candidates()[index].familyHash}`], async () => {
                    const values = await resolve().descriptors[index].sessionBatchCall(resolve().session)(items, "primary");
                    rememberBlocks(items, values);
                    selected = index;
                    attempts.push({ providerId: candidates()[index].id, outcome: "selected", reason: null });
                    return values;
                });
            }
            catch (error) {
                const reason = failureReason(error);
                if (reason === null)
                    throw error;
                attempts.push({ providerId: candidates()[index].id,
                    outcome: reason === "cooldown" ? "cooldown_skipped" : "failed", reason });
                if (reason !== "cooldown")
                    await quarantine(index, reason);
            }
        }
        throw new ApnError("APN_PROVIDER_UNAVAILABLE", "No configured Uniswap token primary provider passed semantic validation.", { reason: "token_primary_pool_exhausted", attemptedProviders: attempts.length.toString() });
    }
    async function selectedBatch(items) {
        const values = await resolve().descriptors[selected].sessionBatchCall(resolve().session)(items, "primary");
        rememberBlocks(items, values);
        return values;
    }
    function rememberBlocks(items, values) {
        for (let index = 0; index < items.length; index += 1)
            if (items[index].method === "eth_getBlockByNumber") {
                try {
                    const block = evmRpcRecord(values[index]), number = evmRpcQuantity(block.number), hash = evmRpcHex(block.hash, 32);
                    primaryBlocks.set(`0x${number.toString(16)}`, hash);
                    if (number > 0n && typeof block.parentHash === "string")
                        primaryBlocks.set(`0x${(number - 1n).toString(16)}`, evmRpcHex(block.parentHash, 32));
                }
                catch { /* The caller decoder owns the required block shape. */ }
            }
    }
    async function verifyArchive(items) {
        const tags = [...new Set(items.map(archiveTag).filter((tag) => tag !== null && !archiveVerified.has(tag)))];
        if (tags.length === 0)
            return;
        if (tags.length > 2 || tags.some((tag) => !primaryBlocks.has(tag)))
            throw new ApnError("APN_RPC_CONFIG", "Uniswap token archive read lacks a primary block anchor.", { reason: "token_archive_block_unanchored" });
        const checks = [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
            ...tags.map((tag) => ({ method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: tokenBlock }))];
        const values = await resolve().descriptors[0].sessionBatchCall(resolve().session)(checks, "archive");
        tokenChain(values[0]);
        for (let index = 0; index < tags.length; index += 1) {
            const block = evmRpcRecord(values[index + 1]), observed = evmRpcHex(block.hash, 32);
            if (observed !== primaryBlocks.get(tags[index]))
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
        return { session, direct: descriptor.call, read: descriptor.sessionCall(session), batch: descriptor.sessionBatchCall(session) };
    })();
    let effects = 0, archiveVerified = false;
    const call = (async (method, params) => {
        if (method === "eth_sendRawTransaction") {
            effects += 1;
            return await resolve().direct(method, params);
        }
        return await resolve().read(method, params);
    });
    Object.defineProperties(call, { batch: { value: async (route, items) => {
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
        effectAttempts: { value: () => effects }, primaryPoolEnabled: { value: () => false }, primaryPoolSize: { value: () => 1 } });
    return call;
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
//# sourceMappingURL=token-rpc.js.map