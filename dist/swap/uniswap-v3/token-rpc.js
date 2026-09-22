import { sha256 } from "../../canonical.js";
import { BridgeHttps } from "../../lifi/https.js";
import { bridgeRpcCall, RpcProviderScheduler, RpcReadSession } from "../../lifi/rpc.js";
export async function tokenBatch(call, route, items) {
    if (items.length < 1 || items.length > 3)
        throw new Error("Token RPC batch must contain one to three items.");
    if (call.batch !== undefined)
        return await call.batch(route, items);
    return await Promise.all(items.map((item) => call(item.method, item.params)));
}
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
    let effects = 0;
    const call = (async (method, params) => {
        if (method === "eth_sendRawTransaction") {
            effects += 1;
            return await resolve().direct(method, params);
        }
        return await resolve().read(method, params);
    });
    Object.defineProperties(call, {
        batch: { value: async (route, items) => await resolve().batch(items.map((item) => ({ ...item, decoder: identity })), route) },
        telemetry: { value: () => initialized?.session.telemetry() ?? null },
        effectAttempts: { value: () => effects },
    });
    return call;
}
function identity(value) { return value; }
//# sourceMappingURL=token-rpc.js.map