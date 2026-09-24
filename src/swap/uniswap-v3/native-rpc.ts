import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";

export interface NativeBatchCall extends EvmRpcCall {
  readonly beginQuote?: () => void;
  readonly batch?: (items: readonly { readonly method: string; readonly params: readonly unknown[] }[]) => Promise<readonly unknown[]>;
}

/** Execution checks use the same RPC endpoint without quote-only batch capability. */
export function scalarUniswapRpcCall(call: EvmRpcCall): EvmRpcCall {
  return async (method, params) => await call(method, params);
}

/** A batch-selected quote never retries its reads as scalar requests. */
export async function nativeReads(call: NativeBatchCall, items: readonly { readonly method: string; readonly params: readonly unknown[] }[]): Promise<readonly unknown[]> {
  if (call.batch === undefined) {
    const values: unknown[] = [];
    for (const item of items) values.push(await call(item.method, item.params));
    return values;
  }
  const values = await call.batch(items);
  if (values.length !== items.length) throw new ApnError("APN_RPC_PROTOCOL", "Uniswap native batch returned the wrong number of values.");
  return values;
}
