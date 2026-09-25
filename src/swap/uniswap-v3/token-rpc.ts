import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { BridgeHttps } from "../../lifi/https.js";
import { bridgeRpcCall, RpcProviderScheduler, RpcReadSession, type RpcReadTelemetry } from "../../lifi/rpc.js";
import { submitDirect } from "../../lifi/rpc-support.js";
import type { StateStore } from "../../state.js";
import { tokenPrimaryCandidates, type TokenPrimaryFailureReason, type TokenPrimaryPoolTelemetry } from "./token-rpc-pool.js";

export type TokenRpcRoute = "primary" | "archive" | "receipt";
export interface TokenRpcItem { readonly method: string; readonly params: readonly unknown[];
  readonly cachePolicy?: "auto" | "immutable" | "snapshot" | "none"; readonly decoder: (value: unknown) => unknown }
export type TokenRpcCall = EvmRpcCall & {
  readonly batch?: (route: TokenRpcRoute, items: readonly TokenRpcItem[]) => Promise<readonly unknown[]>;
  readonly telemetry?: () => RpcReadTelemetry | null;
  readonly effectAttempts?: () => number;
  readonly reserveEffectSlot?: () => void;
  readonly primaryPoolTelemetry?: () => TokenPrimaryPoolTelemetry;
  readonly primaryPoolEnabled?: () => boolean;
  readonly primaryPoolSize?: () => number;
  readonly selectedPrimaryProviderId?: () => string | null;
  readonly bindPrimaryProvider?: (providerId: string | null) => Promise<void>;
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
  readonly maxLogicalItems?: number;
  readonly transport?: Pick<BridgeHttps, "request">; readonly wait?: (milliseconds: number) => Promise<void>;
  readonly pacingNow?: () => number }): TokenRpcCall {
  if (input.environment.APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS === undefined || input.environment.APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS === "") {
    return createLegacyTokenRpc(input);
  }
  let candidateRows: ReturnType<typeof tokenPrimaryCandidates> | undefined;
  const candidates = () => candidateRows ??= tokenPrimaryCandidates(input.environment);
  const scheduler = new RpcProviderScheduler({
    coordinate: async <T>(family: string, work: (lastStart: number | null, saveStart: (value: number) => Promise<void>,
      cooldownUntil: number | null, saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
      const familyHash = sha256(`rpc-provider-family\0${family}`);
      await input.state.initialize();
      return await input.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(
        await input.state.loadRpcProviderPacing(familyHash), async (value) => await input.state.writeRpcProviderPacing(familyHash, value),
        await input.state.loadRpcProviderCooldown(familyHash), async (value) => await input.state.writeRpcProviderCooldown(familyHash, value)));
    },
  }, input.pacingNow, "reject", "transient");
  type Descriptor = ReturnType<typeof bridgeRpcCall>;
  let initialized: { readonly session: RpcReadSession; readonly descriptors: readonly Descriptor[] } | undefined;
  const resolve = () => initialized ??= (() => { const session = new RpcReadSession({ maxLogicalItems: input.maxLogicalItems ?? input.maxHttpRequests * 3,
    maxHttpRequests: input.maxHttpRequests, maxHttpAttempts: input.maxHttpRequests, maxReadAttempts: 1,
    deadlineMs: input.deadlineMs, now: input.now, ...(input.wait === undefined ? {} : { wait: input.wait }), providerScheduler: scheduler });
    const baseTransport = input.transport ?? new BridgeHttps(undefined, undefined, 2_500), transport = { request: async (...args: Parameters<typeof baseTransport.request>) => {
      const response = await baseTransport.request(...args); if (response.status === 200 && capabilityResponse(response.body))
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap token primary does not support bounded JSON-RPC batches.",
          { reason: "token_primary_batch_unsupported" });
      return response.status === 200 && credentialResponse(response.body) ? { ...response, status: 403, body: "" } : response; } }, descriptors = candidates().map((candidate) => bridgeRpcCall(1,
      { ...input.environment, APN_ETHEREUM_RPC_URL: candidate.url.toString() }, { transport }));
    return { session, descriptors }; })();
  let effects = 0, selected: number | null = null;
  const attempts: Array<TokenPrimaryPoolTelemetry["attempts"][number]> = [], tried = new Set<number>();
  const primaryBlocks = new Map<string, string>(), archiveVerified = new Set<string>();
  const call = (async (method, params) => {
    if (selected === null) throw new ApnError("APN_RPC_CONFIG", "Uniswap token primary provider is not semantically selected.",
      { reason: "token_primary_not_selected" });
    const descriptor = resolve().descriptors[selected]!;
    if (method === "eth_sendRawTransaction") return await submitDirect(method, params, async () => await resolve().session.externalAttempt(
      descriptor.origin, async () => { effects += 1; return await descriptor.attempt(method, params); }));
    return await descriptor.sessionCall(resolve().session)(method, params);
  }) as TokenRpcCall;
  Object.defineProperties(call, {
    batch: { value: async (route: TokenRpcRoute, items: readonly TokenRpcItem[]) => {
      if (route === "primary") return await primary(items);
      if (route === "archive") await verifyArchive(items);
      const index = selected ?? 0, descriptor = resolve().descriptors[index]!;
      return await descriptor.sessionBatchCall(resolve().session)(items, route);
    } },
    telemetry: { value: () => initialized?.session.telemetry() ?? null },
    effectAttempts: { value: () => effects },
    reserveEffectSlot: { value: () => resolve().session.reserveExternalAttempt() },
    primaryPoolTelemetry: { value: (): TokenPrimaryPoolTelemetry => ({ schemaVersion: "apn.uniswap-token-primary-pool-telemetry.v1",
      configuredCandidates: candidates().length, selectedProviderId: selected === null ? null : candidates()[selected]!.id, attempts: [...attempts] }) },
    primaryPoolEnabled: { value: () => true },
    primaryPoolSize: { value: () => candidates().length },
    selectedPrimaryProviderId: { value: () => selected === null ? null : candidates()[selected]!.id },
    bindPrimaryProvider: { value: async (providerId: string | null) => { await bindProvider(providerId); } },
  });
  return call;

  async function primary(items: readonly TokenRpcItem[]): Promise<readonly unknown[]> {
    if (selected !== null) return await selectedBatch(items);
    await input.state.initialize();
    for (let index = 0; index < candidates().length; index += 1) {
      if (tried.has(index)) continue; tried.add(index);
      // Pool code always acquires probe before the scheduler's provider-family lock. No path acquires them in reverse.
      const result = await input.state.withLocks([probeLock(index)], async () => { try {
        const values = await resolve().descriptors[index]!.sessionBatchCall(resolve().session)(items, "primary");
        rememberBlocks(items, values); selected = index;
        attempts.push({ providerId: candidates()[index]!.id, outcome: "selected", reason: null });
        return { ok: true as const, values };
      } catch (error) {
        const reason = failureReason(error); if (reason === null) throw error;
        attempts.push({ providerId: candidates()[index]!.id,
          outcome: reason === "cooldown" ? "cooldown_skipped" : "failed", reason });
        if (reason !== "cooldown") await quarantine(index, reason);
        if (reason === "rate_limited") throw error;
        return { ok: false as const };
      } });
      if (result.ok) return result.values;
    }
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "No configured Uniswap token primary provider passed semantic validation.",
      { reason: "token_primary_pool_exhausted", attemptedProviders: attempts.length.toString() });
  }
  async function selectedBatch(items: readonly TokenRpcItem[]) {
    const values = await resolve().descriptors[selected!]!.sessionBatchCall(resolve().session)(items, "primary");
    rememberBlocks(items, values); return values;
  }
  function rememberBlocks(items: readonly TokenRpcItem[], values: readonly unknown[]) {
    for (let index = 0; index < items.length; index += 1) if (items[index]!.method === "eth_getBlockByNumber") {
      try { const block = evmRpcRecord(values[index]), number = evmRpcQuantity(block.number), hash = evmRpcHex(block.hash, 32);
        primaryBlocks.set(`0x${number.toString(16)}`, hash);
        if (number > 0n && typeof block.parentHash === "string") primaryBlocks.set(`0x${(number - 1n).toString(16)}`, evmRpcHex(block.parentHash, 32));
      } catch { /* The caller decoder owns the required block shape. */ }
    }
  }
  async function verifyArchive(items: readonly TokenRpcItem[]) {
    const tags = [...new Set(items.map(archiveTag).filter((tag): tag is string => tag !== null && !archiveVerified.has(tag)))];
    if (tags.length === 0) return;
    if (tags.length > 2 || tags.some((tag) => !primaryBlocks.has(tag))) throw new ApnError("APN_RPC_CONFIG",
      "Uniswap token archive read lacks a primary block anchor.", { reason: "token_archive_block_unanchored" });
    const checks: TokenRpcItem[] = [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
      ...tags.map((tag) => ({ method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable" as const, decoder: tokenBlock }))];
    const values = await resolve().descriptors[0]!.sessionBatchCall(resolve().session)(checks, "archive"); tokenChain(values[0]);
    for (let index = 0; index < tags.length; index += 1) { const block = evmRpcRecord(values[index + 1]), observed = evmRpcHex(block.hash, 32);
      if (observed !== primaryBlocks.get(tags[index]!)) throw new ApnError("APN_RPC_PROTOCOL", "Uniswap token archive block identity mismatched primary.",
        { reason: "token_archive_block_mismatch" }); archiveVerified.add(tags[index]!); }
  }
  async function quarantine(index: number, reason: TokenPrimaryFailureReason) {
    const candidate = candidates()[index]!, duration = reason === "rate_limited" ? 30_000 : 5_000, now = input.pacingNow?.() ?? Date.now();
    await input.state.initialize(); await input.state.withLocks([`rpc-provider-family:${candidate.familyHash}`], async () => {
      const current = await input.state.loadRpcProviderCooldown(candidate.familyHash);
      await input.state.writeRpcProviderCooldown(candidate.familyHash, Math.max(current ?? 0, now + duration));
    });
  }
  async function bindProvider(providerId: string | null) {
    if (providerId === null || !/^[a-f0-9]{64}$/u.test(providerId)) throw new ApnError("APN_OPERATION_BLOCKED",
      "Signed Uniswap token effect has no valid primary provider binding.", { reason: "uniswap_token_provider_binding_missing" });
    const index = candidates().findIndex((candidate) => candidate.id === providerId);
    if (index < 0) throw new ApnError("APN_OPERATION_BLOCKED", "Signed Uniswap token effect provider is unavailable.",
      { reason: "uniswap_token_provider_binding_unavailable" });
    if (selected !== null && selected !== index) throw new ApnError("APN_OPERATION_BLOCKED", "Signed Uniswap token effect provider changed.",
      { reason: "uniswap_token_provider_binding_changed" });
    await input.state.initialize(); await input.state.withLocks([probeLock(index)], async () => {
      await input.state.withLocks([`rpc-provider-family:${candidates()[index]!.familyHash}`], async () => {
        const cooldown = await input.state.loadRpcProviderCooldown(candidates()[index]!.familyHash), now = input.pacingNow?.() ?? Date.now();
        if (cooldown !== null && cooldown > now) throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Signed Uniswap token effect provider is cooling down.",
          { reason: "uniswap_token_bound_provider_cooldown" });
        if (selected === null) { selected = index; tried.add(index); attempts.push({ providerId, outcome: "recovery_bound", reason: null }); }
      });
    });
  }
  function probeLock(index: number) { return `uniswap-token-primary-probe:${candidates()[index]!.familyHash}`; }
}

function createLegacyTokenRpc(input: { readonly environment: Readonly<Record<string, string | undefined>>; readonly state: StateStore;
  readonly now: () => number; readonly maxHttpRequests: number; readonly deadlineMs: number; readonly maxLogicalItems?: number;
  readonly transport?: Pick<BridgeHttps, "request">; readonly wait?: (milliseconds: number) => Promise<void>; readonly pacingNow?: () => number }): TokenRpcCall {
  const scheduler = new RpcProviderScheduler({ coordinate: async <T>(family: string, work: (lastStart: number | null,
    saveStart: (value: number) => Promise<void>, cooldownUntil: number | null, saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
    const familyHash = sha256(`rpc-provider-family\0${family}`); await input.state.initialize();
    return await input.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(
      await input.state.loadRpcProviderPacing(familyHash), async (value) => await input.state.writeRpcProviderPacing(familyHash, value),
      await input.state.loadRpcProviderCooldown(familyHash), async (value) => await input.state.writeRpcProviderCooldown(familyHash, value)));
  } }, input.pacingNow);
  let initialized: { readonly session: RpcReadSession; readonly descriptor: ReturnType<typeof bridgeRpcCall>; readonly read: EvmRpcCall;
    readonly batch: ReturnType<ReturnType<typeof bridgeRpcCall>["sessionBatchCall"]> } | undefined;
  const resolve = () => initialized ??= (() => { const session = new RpcReadSession({ maxLogicalItems: input.maxLogicalItems ?? 96,
    maxHttpRequests: input.maxHttpRequests, maxHttpAttempts: input.maxHttpRequests, maxReadAttempts: 1, deadlineMs: input.deadlineMs,
    now: input.now, ...(input.wait === undefined ? {} : { wait: input.wait }), providerScheduler: scheduler });
    const descriptor = bridgeRpcCall(1, input.environment, { transport: input.transport ?? new BridgeHttps(undefined, undefined, 2_500) });
    return { session, descriptor, read: descriptor.sessionCall(session), batch: descriptor.sessionBatchCall(session) }; })();
  let effects = 0, archiveVerified = false;
  const call = (async (method, params) => { if (method === "eth_sendRawTransaction") return await submitDirect(method, params, async () => await resolve().session.externalAttempt(
    resolve().descriptor.origin, async () => { effects += 1; return await resolve().descriptor.attempt(method, params); }));
    return await resolve().read(method, params); }) as TokenRpcCall;
  Object.defineProperties(call, { batch: { value: async (route: TokenRpcRoute, items: readonly TokenRpcItem[]) => {
    if (route === "archive" && !archiveVerified) { const identity = items.findIndex((item) => item.method === "eth_chainId");
      if (identity >= 0) { const values = await resolve().batch(items, route); tokenChain(values[identity]); archiveVerified = true; return values; }
      await resolve().batch([{ method: "eth_chainId", params: [], cachePolicy: "none", decoder: tokenChain }], route); archiveVerified = true; }
    return await resolve().batch(items, route); } }, telemetry: { value: () => initialized?.session.telemetry() ?? null },
    effectAttempts: { value: () => effects }, reserveEffectSlot: { value: () => resolve().session.reserveExternalAttempt() },
    primaryPoolEnabled: { value: () => false }, primaryPoolSize: { value: () => 1 },
    selectedPrimaryProviderId: { value: () => null }, bindPrimaryProvider: { value: async (providerId: string | null) => {
      if (providerId !== null) throw new ApnError("APN_OPERATION_BLOCKED", "Scalar Uniswap token RPC cannot restore a pooled provider binding.",
        { reason: "uniswap_token_provider_binding_changed" });
    } } });
  return call;
}

function archiveTag(item: TokenRpcItem): string | null {
  const index = item.method === "eth_getStorageAt" ? 2 : ["eth_call", "eth_getCode"].includes(item.method) ? 1 : null;
  if (index === null) return null; const value = item.params[index];
  return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value) ? value.toLowerCase() : null;
}
function failureReason(error: unknown): TokenPrimaryFailureReason | null {
  if (!(error instanceof ApnError)) return null;
  if (error.code === "APN_PROVIDER_UNAVAILABLE" && error.details?.reason === "rpc_provider_cooldown") return "cooldown";
  if (error.code === "APN_RPC_RATE_LIMITED") return "rate_limited";
  if (error.code === "APN_CHAIN_MISMATCH") return "wrong_chain";
  if (error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE") return "capability";
  if (error.code === "APN_RPC_AMBIGUOUS") return "deadline";
  if (error.code === "APN_RPC_PROTOCOL") { const status = Number(error.details?.httpStatus);
    if (status === 401 || status === 403) return "authentication";
    if (status >= 500 && status <= 599) return "http_5xx";
    return "malformed";
  }
  return null;
}
function credentialResponse(body: string): boolean { if (body.length < 2 || body.length > 1_048_576) return false;
  try { const value = JSON.parse(body), rows = Array.isArray(value) ? value : [value]; return rows.some((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false; const error = (row as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null || Array.isArray(error)) return false; const message = (error as Record<string, unknown>).message;
    return typeof message === "string" && ["api key", "apikey", "unauthorized", "authentication", "access denied"]
      .some((part) => message.toLowerCase().includes(part)); });
  } catch { return false; } }
function capabilityResponse(body: string): boolean { if (body.length < 2 || body.length > 1_048_576) return false;
  try { const value = JSON.parse(body), rows = Array.isArray(value) ? value : [value]; return rows.some((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false; const error = (row as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null || Array.isArray(error)) return false; const message = (error as Record<string, unknown>).message;
    return typeof message === "string" && ["batch requests are not supported", "batch requests not supported", "batch unsupported"]
      .includes(message.trim().toLowerCase()); });
  } catch { return false; } }
