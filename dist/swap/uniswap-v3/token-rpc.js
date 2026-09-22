import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { BridgeHttps } from "../../lifi/https.js";
import { bridgeRpcCall, RpcProviderScheduler, RpcReadSession } from "../../lifi/rpc.js";
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
    const scheduler = new RpcProviderScheduler({
        coordinate: async (family, work) => {
            const familyHash = sha256(`rpc-provider-family\0${family}`);
            await input.state.initialize();
            return await input.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await input.state.loadRpcProviderPacing(familyHash), async (value) => await input.state.writeRpcProviderPacing(familyHash, value), await input.state.loadRpcProviderCooldown(familyHash), async (value) => await input.state.writeRpcProviderCooldown(familyHash, value)));
        },
    }, input.pacingNow);
    let initialized;
    const resolve = () => initialized ??= (() => {
        const session = new RpcReadSession({ maxLogicalItems: 96,
            maxHttpRequests: input.maxHttpRequests, maxHttpAttempts: input.maxHttpRequests, maxReadAttempts: 1,
            deadlineMs: input.deadlineMs, now: input.now, ...(input.wait === undefined ? {} : { wait: input.wait }), providerScheduler: scheduler });
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
    Object.defineProperties(call, {
        batch: { value: async (route, items) => {
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
            } },
        telemetry: { value: () => initialized?.session.telemetry() ?? null },
        effectAttempts: { value: () => effects },
    });
    return call;
}
//# sourceMappingURL=token-rpc.js.map