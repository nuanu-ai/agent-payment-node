import { homedir } from "node:os";
import { encodeFunctionData, hashTypedData, parseAbi } from "viem";
import { isPlainRecord } from "../../canonical.js";
import { mmQuoteHash } from "../economics.js";
import { mmPrivateHash } from "../identity.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessIntent, MetaMaskGaslessProviderObservation,
  MetaMaskGaslessQuote, MetaMaskGaslessUnsignedResult } from "../model.js";
import { mmRegistry } from "../registry.js";
import { mmClassify, mmFail, mmFailure } from "../reasons.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmAddress, mmHex, mmUint } from "../validation.js";
import { HelperNetworkPolicy, networkContextEmpty, networkContextQuote, networkContextRequest,
  type FetchExchange } from "./network.js";
import { readPrivateState, type PrivateState } from "./private-state.js";
import { helperRequest, MM_HELPER_VERSION, type HelperRequest, type HelperResponse, type HelperResult } from "./protocol.js";
import { hydrateSdkState } from "./session.js";

const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const SERVER_URL = "https://agentic-mimir-service.api.cx.metamask.io";
const ACCOUNTS_URL = "https://agentic-proxy.workers.cx.metamask.io/proxy/prd/accounts";
const INFURA_URL = "https://agentic-proxy.workers.cx.metamask.io/infura-service/v1";
const PROXY_URL = "https://agentic-proxy.workers.cx.metamask.io";

export interface HelperExecutionOptions {
  readonly homeDirectory?: string;
  readonly now?: () => Date;
  readonly exchange?: FetchExchange;
}

export async function executeHelperRequest(input: unknown, options: HelperExecutionOptions = {}): Promise<HelperResponse> {
  let request: HelperRequest;
  try { request = helperRequest(input); }
  catch (error) { return { version: MM_HELPER_VERSION, ok: false, failure: mmClassify(error, "mm_gasless_input") }; }
  const now = options.now ?? (() => new Date());
  const home = options.homeDirectory ?? homedir();
  let policy: HelperNetworkPolicy | undefined;
  const originalFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const consoleMethods = saveConsole();
  try {
    if (typeof (globalThis as { document?: unknown }).document !== "undefined") mmFail("mm_gasless_state_security");
    if (request.mode === "buildUnsigned") policy = new HelperNetworkPolicy(networkContextEmpty("buildUnsigned"), options.exchange);
    else if (request.mode === "inspect") policy = new HelperNetworkPolicy(networkContextEmpty("inspect"), options.exchange);
    else {
      const expected = request.mode === "quote" ? request.input.binding : request.intent.binding;
      const firstObservedAt = now();
      const state = await readPrivateState(home, expected, firstObservedAt);
      policy = request.mode === "quote" ? new HelperNetworkPolicy(networkContextQuote(request.input, state.address, state.token), options.exchange) :
        new HelperNetworkPolicy(networkContextRequest(request.mode, request.intent, state.projectId, state.token, now), options.exchange);
      if (request.mode === "submit") policy.primeSubmitClock(firstObservedAt);
      globalThis.fetch = policy.fetch;
      const result = request.mode === "quote" ? await quote(request.input, state, policy) : request.mode === "submit" ?
        await submit(request.intent, state, home, now, policy, firstObservedAt) : await observe(request.intent, state, policy, now);
      policy.assertComplete();
      return { version: MM_HELPER_VERSION, ok: true, result };
    }
    globalThis.fetch = policy.fetch;
    const result = request.mode === "inspect" ? await inspect(home, request.expected, now()) : await buildUnsigned(request.input);
    policy.assertComplete();
    return { version: MM_HELPER_VERSION, ok: true, result };
  } catch (error) {
    const fixedFailure = policy?.fixedFailure();
    if (fixedFailure) return { version: MM_HELPER_VERSION, ok: false, failure: mmFailure(fixedFailure) };
    return { version: MM_HELPER_VERSION, ok: false, failure: mmClassify(error, fallback(request.mode)) };
  } finally {
    globalThis.fetch = originalFetch; restoreWindow(windowDescriptor); restoreConsole(consoleMethods);
  }
}

async function inspect(home: string, expected: Extract<HelperRequest, { mode: "inspect" }>["expected"], now: Date): Promise<MetaMaskGaslessBinding> {
  const state = await readPrivateState(home, expected, now), hydrated = await hydrateSdkState(state);
  if (hydrated.writes() !== 0 || hydrated.session.walletMode !== "server-wallet" ||
    !isPlainRecord(hydrated.walletState.selectedWallet)) mmFail("mm_gasless_state_corrupt");
  return state.binding;
}

async function quote(input: Extract<HelperRequest, { mode: "quote" }>["input"], state: PrivateState,
  policy: HelperNetworkPolicy): Promise<MetaMaskGaslessQuote> {
  const sdk = await import("@metamask/agent-sdk");
  sdk.disableAnalytics();
  const evm = await import("@metamask/agent-sdk/evm");
  const hydrated = await hydrateSdkState(state);
  let cacheWrites = 0; let cache: unknown = null;
  const registry = new sdk.NetworkRegistry({ env: "prod", storage: { read: () => cache as never,
    write: (value) => { if (++cacheWrites !== 1) mmFail("mm_gasless_provider_unavailable"); cache = structuredClone(value); } },
  logger: logger(), getAuthTokenFn: () => state.token });
  const snapshot = await registry.getSnapshot();
  if (cacheWrites !== 1 || cache === null) mmFail("mm_gasless_provider_unavailable");
  policy.assertQuoteInventories();
  const baseChain = evm.getAgenticEvmChains().find((chain) => chain.chainId === input.chainId);
  if (!baseChain) mmFail("mm_gasless_unsupported_chain");
  const rpcChain = evm.withEvmRpcTarget(baseChain, input.rpcUrl);
  if (rpcChain.rpcTarget !== input.rpcUrl) mmFail("mm_gasless_rpc_binding");
  const walletState = structuredClone(hydrated.walletState) as { customEvmChains: unknown[] } & Record<string, unknown>;
  walletState.customEvmChains = [...walletState.customEvmChains.filter((row) => !isPlainRecord(row) || row.chainId !== input.chainId), rpcChain];
  if (walletState.customEvmChains.filter((row) => isPlainRecord(row) && row.chainId === input.chainId).length !== 1) mmFail("mm_gasless_rpc_binding");
  let resolverCalls = 0;
  const service = sdk.createWalletServiceFromSession({ session: hydrated.session as never, walletState: walletState as never,
    resolveMnemonic: async () => { resolverCalls += 1; return mmFail("mm_gasless_capability_unavailable"); },
    defaultNamespace: "evm", serverWalletBaseUrl: SERVER_URL, accountsApiBaseUrl: ACCOUNTS_URL,
    infuraRpcBaseUrl: INFURA_URL, priceService: new sdk.PriceService("prod", () => state.token), networkRegistry: registry,
    logger: logger() });
  const relay = { host: PROXY_URL, env: "prod" as const, getHeaders: () => ({ Authorization: `Bearer ${state.token}` }) };
  if (!await service.isGaslessRelaySupported({ chainId: input.chainId, relay })) mmFail("mm_gasless_capability_unavailable");
  const raw = await service.quoteGaslessTransfer({ state: walletState as never, chainId: input.chainId, recipient: input.recipient,
    amount: formatSix(input.netAtomic), token: input.token, gasToken: input.token, relay });
  if (resolverCalls !== 0 || hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  return validateSdkQuote(raw, input, state.address);
}

async function buildUnsigned(input: Extract<HelperRequest, { mode: "buildUnsigned" }>["input"]): Promise<MetaMaskGaslessUnsignedResult> {
  const evm = await import("@metamask/fox-sdk/wallets/evm");
  const controller = await import("@toruslabs/ethereum-controllers");
  mmRegistry(input.chainId);
  const executions = input.executions.map((item) => ({ target: item.target, value: BigInt(item.value), callData: item.callData }));
  const prepared = evm.prepareDelegation({ delegator: input.owner, chainId: input.chainId, executions });
  const unsignedDelegation = { delegator: mmAddress(prepared.unsignedDelegation.delegator),
    delegate: mmAddress(prepared.unsignedDelegation.delegate), authority: prepared.unsignedDelegation.authority,
    salt: prepared.unsignedDelegation.salt, caveats: prepared.unsignedDelegation.caveats.map((caveat) => ({
      enforcer: mmAddress(caveat.enforcer), terms: caveat.terms, args: caveat.args })) };
  const result = { unsignedDelegation,
    delegationHash: controller.getDelegationHashOffchain(unsignedDelegation as never),
    signingDigest: hashTypedData(prepared.typedData as never), relayTo: mmAddress(prepared.relayTo), mode: prepared.modes[0]! };
  return mmValidateUnsigned(result, input);
}

async function submit(intent: MetaMaskGaslessIntent, first: PrivateState, home: string, now: () => Date,
  policy: HelperNetworkPolicy, firstObservedAt: Date): Promise<MetaMaskGaslessProviderObservation> {
  const evm = await import("@metamask/fox-sdk/wallets/evm");
  const keyrings = await import("@metamask/fox-sdk/wallets/keyring");
  const firstHydrated = await hydrateSdkState(first);
  if (firstHydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  const { keyring } = await keyrings.createKeyringController({ mode: keyrings.KEYRING_KIND.SERVER,
    input: { baseUrl: SERVER_URL, authToken: first.token, projectId: first.projectId,
      wallets: firstHydrated.walletState.remoteWallets as never[] }, adapters: [(deps) => new evm.EvmServerAdapter(deps)], logLevel: "silent" });
  const adapter = evm.evmServerAdapter(keyring);
  const secondObservedAt = now();
  if (secondObservedAt.getTime() < firstObservedAt.getTime()) mmFail("mm_gasless_clock");
  const second = await readPrivateState(home, intent.binding, secondObservedAt);
  const secondHydrated = await hydrateSdkState(second);
  if (secondHydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  if (second.generationHash !== first.generationHash || second.projectId !== first.projectId || second.token !== first.token) {
    mmFail("mm_gasless_binding_changed");
  }
  assertBeforeDeadline(intent.expiresAt, now());
  const wireExecutions = evm.executionsToWire(intent.quote.executions.map((item) => ({ target: item.target, value: BigInt(item.value), callData: item.callData })));
  const wireDelegation = evm.unsignedDelegationToWire(intent.unsignedDelegation as never);
  const expectedBody = { requestId: intent.requestId, method: "eth_sendRelayTransaction", encoding: "redeemDelegations",
    tx: { from: intent.binding.address, chainId: intent.request.chainId }, executions: wireExecutions, delegation: wireDelegation };
  policy.setExpectedSubmitBody(expectedBody);
  const status = await adapter.submitRelayTransaction({ from: intent.binding.address, chainId: intent.request.chainId,
    executions: wireExecutions, delegation: wireDelegation },
  { chainId: intent.request.chainId, origin: "apn", requestId: intent.requestId });
  return providerObservation(status, intent, now(), "mm_gasless_submit_unknown");
}

async function observe(intent: MetaMaskGaslessIntent, state: PrivateState, policy: HelperNetworkPolicy,
  now: () => Date): Promise<MetaMaskGaslessProviderObservation> {
  const evm = await import("@metamask/fox-sdk/wallets/evm");
  const keyrings = await import("@metamask/fox-sdk/wallets/keyring");
  const hydrated = await hydrateSdkState(state);
  if (hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  const { keyring } = await keyrings.createKeyringController({ mode: keyrings.KEYRING_KIND.SERVER,
    input: { baseUrl: SERVER_URL, authToken: state.token, projectId: state.projectId,
      wallets: hydrated.walletState.remoteWallets as never[] }, adapters: [(deps) => new evm.EvmServerAdapter(deps)], logLevel: "silent" });
  try {
    const status = await evm.evmServerAdapter(keyring).getJobStatus({ pollingId: intent.requestId, kind: evm.SIGN_REQUEST_KIND.TRANSACTION });
    return providerObservation(status, intent, now(), "mm_gasless_provider_unavailable");
  } catch (error) {
    if (policy.didObserveNotFound()) return unavailable(intent, now());
    throw error;
  }
}

function validateSdkQuote(value: unknown, input: Extract<HelperRequest, { mode: "quote" }>["input"], owner: string): MetaMaskGaslessQuote {
  if (!isPlainRecord(value) || typeof value.amount !== "bigint" || value.amount !== mmUint(input.netAtomic, true) ||
    mmAddress(value.token, "mm_gasless_quote_invalid") !== input.token || mmAddress(value.recipient, "mm_gasless_quote_invalid") !== input.recipient ||
    mmAddress(value.feeToken, "mm_gasless_quote_invalid") !== input.token || typeof value.feeAmount !== "bigint" || value.feeAmount < 0n ||
    value.feeDecimals !== 6 || typeof value.feeTokenSymbol !== "string" || value.feeTokenSymbol.length < 1 || value.feeTokenSymbol.length > 32 ||
    !Array.isArray(value.executions) || value.executions.length !== 2) mmFail("mm_gasless_quote_invalid");
  const feeRecipient = mmAddress(value.feeRecipient, "mm_gasless_quote_invalid");
  if (feeRecipient === owner || feeRecipient === input.recipient || feeRecipient === input.token) mmFail("mm_gasless_quote_invalid");
  const amounts = [value.amount, value.feeAmount] as const, recipients = [input.recipient, feeRecipient] as const;
  const executions = value.executions.map((raw, index) => {
    if (!isPlainRecord(raw) || typeof raw.value !== "bigint") mmFail("mm_gasless_quote_invalid");
    const target = mmAddress(raw.target, "mm_gasless_quote_invalid"), callData = mmHex(raw.callData, undefined, "mm_gasless_quote_invalid");
    const expected = encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [recipients[index]!, amounts[index]!] });
    if (target !== input.token || raw.value !== 0n || callData !== expected) mmFail("mm_gasless_quote_invalid");
    return { target, value: "0", callData };
  }) as unknown as MetaMaskGaslessQuote["executions"];
  const material = { netAtomic: value.amount.toString(), feeAtomic: value.feeAmount.toString(), feeRecipient, executions };
  return { ...material, hash: mmQuoteHash(material) };
}

function providerObservation(value: unknown, intent: MetaMaskGaslessIntent, now: Date,
  reason: "mm_gasless_submit_unknown" | "mm_gasless_provider_unavailable"): MetaMaskGaslessProviderObservation {
  if (!isPlainRecord(value) || value.requestId !== intent.requestId || value.kind !== "transaction" || typeof value.status !== "string" ||
    !isPlainRecord(value.tx) || String(value.tx.from).toLowerCase() !== intent.binding.address || value.tx.chainId !== intent.request.chainId) {
    mmFail(reason);
  }
  const allowed = new Set(["requestId", "kind", "status", "tx", "txApprovalLink", "signedTransaction", "broadcastId", "txHash", "txBlock",
    "failureCode", "failureDescription", "approval"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) mmFail(reason);
  const txHash = value.txHash === undefined ? null : mmHex(value.txHash, 32, reason);
  const pending = ["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"];
  const failed = ["DENIED", "EXPIRED", "FAILED", "BROADCAST_FAILED"];
  const unavailableStatuses = ["BROADCAST_TRACKING_EXPIRED", "CONFIRMATION_TRACKING_EXPIRED"];
  const status = pending.includes(value.status) ? "pending" : value.status === "BROADCASTED" ? "broadcasted" :
    value.status === "CONFIRMED" ? "confirmed" : failed.includes(value.status) ? "failed" :
      unavailableStatuses.includes(value.status) ? "unavailable" : mmFail(reason);
  return { observedAt: now.toISOString(), requestIdHash: mmPrivateHash("request-id", intent.requestId), status, txHash };
}
function unavailable(intent: MetaMaskGaslessIntent, now: Date): MetaMaskGaslessProviderObservation {
  return { observedAt: now.toISOString(), requestIdHash: mmPrivateHash("request-id", intent.requestId), status: "unavailable", txHash: null };
}
function formatSix(value: string): string {
  const n = mmUint(value, true), fraction = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${n / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
function assertBeforeDeadline(value: string, now: Date): void {
  const expires = Date.parse(value), current = now.getTime();
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(current) || current >= expires) mmFail("mm_gasless_expired");
}
function fallback(mode: HelperRequest["mode"]) {
  return mode === "submit" ? "mm_gasless_submit_unknown" as const : mode === "buildUnsigned" ?
    "mm_gasless_internal" as const : "mm_gasless_provider_unavailable" as const;
}
function logger() { return { debug: (_message: string) => undefined, info: (_message: string) => undefined,
  warn: (_message: string) => undefined, error: (_message: string) => undefined, reset: () => undefined,
  enable: (_methods: unknown) => undefined }; }
function saveConsole(): Array<[keyof Console, unknown]> {
  const entries: Array<[keyof Console, unknown]> = [];
  for (const key of ["log", "error", "warn", "info", "debug"] as const) { entries.push([key, console[key]]); console[key] = (() => undefined) as never; }
  return entries;
}
function restoreConsole(entries: Array<[keyof Console, unknown]>): void { for (const [key, value] of entries) (console as unknown as Record<string, unknown>)[key] = value; }
function restoreWindow(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window");
}
export type { HelperRequest, HelperResponse, HelperResult } from "./protocol.js";
