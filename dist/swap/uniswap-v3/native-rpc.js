import { ApnError } from "../../errors.js";
/** Execution checks use the same RPC endpoint without quote-only batch capability. */
export function scalarUniswapRpcCall(call) {
    return async (method, params) => await call(method, params);
}
/** A batch-selected quote never retries its reads as scalar requests. */
export async function nativeReads(call, items) {
    if (call.batch === undefined) {
        const values = [];
        for (const item of items)
            values.push(await call(item.method, item.params));
        return values;
    }
    const values = await call.batch(items);
    if (values.length !== items.length)
        throw new ApnError("APN_RPC_PROTOCOL", "Uniswap native batch returned the wrong number of values.");
    return values;
}
//# sourceMappingURL=native-rpc.js.map