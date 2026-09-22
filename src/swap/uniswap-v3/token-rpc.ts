import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { BridgeHttps } from "../../lifi/https.js";
import { bridgeRpcCall, RpcProviderScheduler, RpcReadSession, type RpcReadTelemetry } from "../../lifi/rpc.js";
import type { StateStore } from "../../state.js";

export type TokenRpcRoute = "primary" | "archive" | "receipt";
export interface TokenRpcItem { readonly method: string; readonly params: readonly unknown[];
  readonly cachePolicy?: "auto" | "immutable" | "snapshot" | "none"; readonly decoder: (value: unknown) => unknown }
export type TokenRpcCall = EvmRpcCall & {
  readonly batch?: (route: TokenRpcRoute, items: readonly TokenRpcItem[]) => Promise<readonly unknown[]>;
  readonly telemetry?: () => RpcReadTelemetry | null;
  readonly effectAttempts?: () => number;
};

export async function tokenBatch(call: TokenRpcCall, route: TokenRpcRoute, items: readonly TokenRpcItem[]): Promise<readonly unknown[]> {
  if (items.length < 1 || items.length > 3) throw new Error("Token RPC batch must contain one to three items.");
  if (call.batch !== undefined) return await call.batch(route, items);
  return await Promise.all(items.map((item) => call(item.method, item.params)));
}
export function tokenChain(value: unknown): unknown { if (evmRpcQuantity(value) !== 1n)
  throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token RPC route requires Ethereum chain 1."); return value; }
export function tokenQuantity(value: unknown): unknown { evmRpcQuantity(value); return value; }
export function tokenHex(bytes?: number): (value: unknown) => unknown { return (value) => { evmRpcHex(value, bytes); return value; }; }
export function tokenBlock(value: unknown): unknown { const record = evmRpcRecord(value); evmRpcQuantity(record.number); evmRpcHex(record.hash, 32); return value; }
export function tokenNullableRecord(value: unknown): unknown { if (value !== null) evmRpcRecord(value); return value; }

export function createTokenRpc(input: { readonly environment: Readonly<Record<string, string | undefined>>; readonly state: StateStore;
  readonly now: () => number; readonly maxHttpRequests: number; readonly deadlineMs: number;
  readonly transport?: Pick<BridgeHttps, "request">; readonly wait?: (milliseconds: number) => Promise<void>;
  readonly pacingNow?: () => number }): TokenRpcCall {
  const scheduler = new RpcProviderScheduler({
    coordinate: async <T>(family: string, work: (lastStart: number | null, saveStart: (value: number) => Promise<void>,
      cooldownUntil: number | null, saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
      const familyHash = sha256(`rpc-provider-family\0${family}`);
      await input.state.initialize();
      return await input.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(
        await input.state.loadRpcProviderPacing(familyHash), async (value) => await input.state.writeRpcProviderPacing(familyHash, value),
        await input.state.loadRpcProviderCooldown(familyHash), async (value) => await input.state.writeRpcProviderCooldown(familyHash, value)));
    },
  }, input.pacingNow);
  let initialized: { readonly session: RpcReadSession; readonly direct: EvmRpcCall; readonly read: EvmRpcCall;
    readonly batch: ReturnType<ReturnType<typeof bridgeRpcCall>["sessionBatchCall"]> } | undefined;
  const resolve = () => initialized ??= (() => { const session = new RpcReadSession({ maxLogicalItems: 96,
    maxHttpRequests: input.maxHttpRequests, maxHttpAttempts: input.maxHttpRequests, maxReadAttempts: 1,
    deadlineMs: input.deadlineMs, now: input.now, ...(input.wait === undefined ? {} : { wait: input.wait }), providerScheduler: scheduler });
    const descriptor = bridgeRpcCall(1, input.environment, { transport: input.transport ?? new BridgeHttps(undefined, undefined, 2_500) });
    return { session, direct: descriptor.call, read: descriptor.sessionCall(session), batch: descriptor.sessionBatchCall(session) }; })();
  let effects = 0, archiveVerified = false;
  const call = (async (method, params) => { if (method === "eth_sendRawTransaction") { effects += 1; return await resolve().direct(method, params); }
    return await resolve().read(method, params); }) as TokenRpcCall;
  Object.defineProperties(call, {
    batch: { value: async (route: TokenRpcRoute, items: readonly TokenRpcItem[]) => {
      if (route === "archive" && !archiveVerified) {
        const identity = items.findIndex((item) => item.method === "eth_chainId");
        if (identity >= 0) { const values = await resolve().batch(items, route); tokenChain(values[identity]); archiveVerified = true; return values; }
        await resolve().batch([{ method: "eth_chainId", params: [], cachePolicy: "none", decoder: tokenChain }], route); archiveVerified = true;
      }
      return await resolve().batch(items, route);
    } },
    telemetry: { value: () => initialized?.session.telemetry() ?? null },
    effectAttempts: { value: () => effects },
  });
  return call;
}
