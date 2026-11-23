import { ApnError } from "../../errors.js";
import { readDiagnostic, type ReadStage } from "./read-diagnostic.js";
import { submitDiagnostic, submitToken, type SubmitCheck, type SubmitStage } from "./submit-diagnostic.js";
import { jobTx, type MetaMaskJobTx } from "./job-tx.js";
import { observeDiagnostic, type ObserveCheck } from "./observe-diagnostic.js";
import { agentSdk, agentEvm, foxEvm, foxKeyring, ethereumControllers } from "./sdk-vendor.js";
import { homedir } from "node:os";
import { encodeFunctionData, hashTypedData, parseAbi } from "viem";
import { isPlainRecord, sha256 } from "../../canonical.js";
import { mmQuoteHash } from "../economics.js";
import { mmPrivateHash } from "../identity.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessProviderIntent, MetaMaskGaslessProviderObservation,
  MetaMaskGaslessQuote, MetaMaskGaslessUnsignedResult } from "../model.js";
import { mmChainFacts, mmRegistry } from "../registry.js";
import { mmClassify, mmFail, mmFailure } from "../reasons.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmAddress, mmFormat, mmHex, mmUint } from "../validation.js";
import { HelperNetworkPolicy, networkContextEmpty, networkContextQuote, networkContextRequest, networkContextServerRequest,
  networkContextServerTransaction, type FetchExchange } from "./network.js";
import { readPrivateSession, readPrivateState, type PrivateSession, type PrivateState } from "./private-state.js";
import { serverRequestAnswer, serverRequestNotFound, type MetaMaskServerRequestQuery, type MetaMaskServerRequestRead } from "./server-request.js";
import { assertProjectWallet } from "./project-wallets.js";
import { helperRequest, helperSends, MM_HELPER_VERSION, type HelperRequest, type HelperResponse, type HelperResult } from "./protocol.js";
import { assertServerTransactionSession, submitServerTransaction } from "./server-transaction-submit.js";
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
  /** The helper process's watch of the APN command that spawned it (helper-entry.ts), checked right before a send is written. */
  readonly parentAlive?: () => boolean;
}

export async function executeHelperRequest(input: unknown, options: HelperExecutionOptions = {}): Promise<HelperResponse> {
  let request: HelperRequest;
  try { request = helperRequest(input); }
  catch (error) { return { version: MM_HELPER_VERSION, ok: false, failure: mmClassify(error, "mm_gasless_input") }; }
  const now = options.now ?? (() => new Date());
  const home = options.homeDirectory ?? homedir();
  let policy: HelperNetworkPolicy | undefined;
  const phase: { stage: ReadStage } = { stage: "private_state" };
  // The submit's own stage and the response check that refused, for its closed diagnostic (submit-diagnostic.ts).
  const sent: SubmitProgress = { stage: "private_state", check: undefined, providerStatus: null, tx: undefined };
  // An observation's own refused answer check, for its closed diagnostic (observe-diagnostic.ts).
  const seen: ResponseProgress = { check: undefined, providerStatus: null, tx: undefined };
  const originalFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const consoleMethods = saveConsole();
  try {
    if (typeof (globalThis as { document?: unknown }).document !== "undefined") mmFail("mm_gasless_state_security");
    if (request.mode === "buildUnsigned") policy = new HelperNetworkPolicy(networkContextEmpty("buildUnsigned"), options.exchange);
    else if (request.mode === "inspect") policy = new HelperNetworkPolicy(networkContextEmpty("inspect"), options.exchange);
    else if (request.mode === "readRequest") {
      const session = await readPrivateSession(home, now());
      // Only the operation's own MetaMask project is read: a session signed in to another one refuses before any read.
      if (sha256(session.projectId) !== request.query.projectHash) mmFail("mm_gasless_binding_changed");
      policy = new HelperNetworkPolicy(networkContextServerRequest(request.query, session.projectId, session.token), options.exchange);
      globalThis.fetch = policy.fetch;
      const result = await readServerRequest(request.query, session, policy, seen);
      policy.assertComplete();
      return { version: MM_HELPER_VERSION, ok: true, result };
    } else if (request.mode === "submitTransaction") {
      const session = await readPrivateSession(home, now());
      // Only the request's own project and selected server wallet: another one refuses before any network call.
      assertServerTransactionSession(session, request.transaction);
      policy = new HelperNetworkPolicy(networkContextServerTransaction(request.transaction, session.projectId, session.token, now), options.exchange,
        options.parentAlive);
      globalThis.fetch = policy.fetch;
      const result = await submitServerTransaction(request.transaction, session, home, now, policy, sent);
      sent.stage = "complete";
      policy.assertComplete();
      return { version: MM_HELPER_VERSION, ok: true, result };
    } else {
      const expected = request.mode === "quote" ? request.input.binding : request.intent.binding;
      const firstObservedAt = now();
      const state = await readPrivateState(home, expected, firstObservedAt);
      policy = request.mode === "quote" ? new HelperNetworkPolicy(networkContextQuote(request.input, state.address, state.token, state.projectId),
        options.exchange) :
        new HelperNetworkPolicy(networkContextRequest(request.mode, request.intent, state.projectId, state.token, now), options.exchange,
          options.parentAlive);
      if (request.mode === "submit") policy.primeSubmitClock(firstObservedAt);
      globalThis.fetch = policy.fetch;
      const result = request.mode === "quote" ? await quote(request.input, state, policy, phase) : request.mode === "submit" ?
        await submit(request.intent, state, home, now, policy, firstObservedAt, sent) : await observe(request.intent, state, policy, now, seen);
      if (request.mode === "submit") sent.stage = "complete";
      policy.assertComplete();
      return { version: MM_HELPER_VERSION, ok: true, result };
    }
    globalThis.fetch = policy.fetch;
    const result = request.mode === "inspect" ? await inspect(home, request.expected, now(), phase) : await buildUnsigned(request.input);
    policy.assertComplete();
    return { version: MM_HELPER_VERSION, ok: true, result };
  } catch (error) {
    const fixedFailure = policy?.fixedFailure();
    const failure = fixedFailure ? mmFailure(fixedFailure) : mmClassify(error, fallback(request.mode));
    if (request.mode === "inspect" || request.mode === "quote") {
      const context = policy?.readFailureContext(error);
      const invariant = context?.validationFailed ? "network_validation" : error instanceof ApnError ? "closed_failure" : "unclassified_exception";
      // Relay facts accompany only APN's own closed relay refusal, fee facts only a classified missing fee list and
      // USDC facts only APN's own closed balance refusal at the fee quote.
      const closed = invariant === "closed_failure" && context?.network === "none";
      const relay = failure.reason === "mm_gasless_relay_unsupported" && phase.stage === "relay_support" && closed ? policy?.relaySupportFacts() : undefined;
      const usdc = failure.reason === "mm_gasless_balance" && phase.stage === "fee_quote" && closed ? policy?.usdcShortfall() : undefined;
      const wallets = failure.reason === "mm_gasless_wallet_not_in_project" && phase.stage === "project_wallets" && closed
        ? policy?.projectWalletFacts() : undefined;
      return { version: MM_HELPER_VERSION, ok: false, failure, diagnostic: readDiagnostic(request.mode, phase.stage,
        invariant, context?.network, context?.httpStatus, null, "none", false, context?.validationPredicate, context?.tokenFeesShape,
        { ...context?.feeFacts, ...relay, ...usdc, ...wallets }) };
    }
    if (helperSends(request.mode)) {
      const facts = policy?.submitFacts();
      // A sent POST answered outside 2xx, with no check of APN's own refusing, is the provider's answer itself; a sent
      // POST with no answer at all (a transport failure after it left) says so.
      const post = facts?.post ?? "not_reached", status = facts?.httpStatus ?? null;
      const answered = post === "sent" && status !== null && (status < 200 || status >= 300);
      const check: SubmitCheck = facts !== undefined && facts.check !== "none" ? facts.check
        : sent.check ?? (answered ? "http_status" : post === "sent" && status === null ? "no_answer" : "unclassified");
      // The diagnostic never replaces the failure: one that does not validate is left out.
      let diagnostic;
      try {
        diagnostic = submitDiagnostic(sent.stage, { post, httpStatus: status, check, providerError: facts?.providerError ?? null,
          providerStatus: check === "response_status" || check === "response_tx" ? sent.providerStatus : null,
          responseTx: check === "response_tx" ? sent.tx ?? null : null });
      } catch { diagnostic = undefined; }
      return { version: MM_HELPER_VERSION, ok: false, failure, ...(diagnostic === undefined ? {} : { submitDiagnostic: diagnostic }) };
    }
    if ((request.mode === "observe" || request.mode === "readRequest") && seen.check !== undefined) {
      let diagnostic;
      try { diagnostic = observeDiagnostic(seen.check as ObserveCheck, seen.providerStatus, seen.check === "response_tx" ? seen.tx ?? null : null); }
      catch { diagnostic = undefined; }
      return { version: MM_HELPER_VERSION, ok: false, failure, ...(diagnostic === undefined ? {} : { observeDiagnostic: diagnostic }) };
    }
    return { version: MM_HELPER_VERSION, ok: false, failure };
  } finally {
    globalThis.fetch = originalFetch; restoreWindow(windowDescriptor); restoreConsole(consoleMethods);
  }
}

async function inspect(home: string, expected: Extract<HelperRequest, { mode: "inspect" }>["expected"], now: Date, phase: { stage: ReadStage }): Promise<MetaMaskGaslessBinding> {
  phase.stage = "private_state";
  const state = await readPrivateState(home, expected, now);
  phase.stage = "hydrate";
  const hydrated = await hydrateSdkState(state);
  phase.stage = "inspect";
  if (hydrated.writes() !== 0 || hydrated.session.walletMode !== "server-wallet" ||
    !isPlainRecord(hydrated.walletState.selectedWallet)) mmFail("mm_gasless_state_corrupt");
  return state.binding;
}

async function quote(input: Extract<HelperRequest, { mode: "quote" }>["input"], state: PrivateState,
  policy: HelperNetworkPolicy, phase: { stage: ReadStage }): Promise<MetaMaskGaslessQuote> {
  phase.stage = "project_wallets";
  await assertProjectWallet(policy.fetch, state);
  phase.stage = "sdk_load";
  const sdk = await agentSdk();
  sdk.disableAnalytics();
  const evm = await agentEvm();
  phase.stage = "hydrate";
  const hydrated = await hydrateSdkState(state);
  phase.stage = "inventory";
  let cacheWrites = 0; let cache: unknown = null;
  const registry = new sdk.NetworkRegistry({ env: "prod", storage: { read: () => cache as never,
    write: (value) => { if (++cacheWrites !== 1) mmFail("mm_gasless_provider_unavailable"); cache = structuredClone(value); } },
  logger: logger(), getAuthTokenFn: () => state.token });
  const snapshot = await registry.getSnapshot();
  if (cacheWrites !== 1 || cache === null) mmFail("mm_gasless_provider_unavailable");
  policy.assertQuoteInventories();
  phase.stage = "chain_override";
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
  phase.stage = "relay_support";
  if (!await service.isGaslessRelaySupported({ chainId: input.chainId, relay })) mmFail("mm_gasless_relay_unsupported");
  phase.stage = "fee_quote";
  let raw: unknown;
  try {
    raw = await service.quoteGaslessTransfer({ state: walletState as never, chainId: input.chainId, recipient: input.recipient,
      // The SDK parses this decimal text at the decimals it reads on chain, which the network policy holds to the row's.
      amount: mmFormat(input.netAtomic, mmRegistry(input.chainId, input.token).row.decimals), token: input.token, gasToken: input.token, relay });
  } catch (error) {
    const sponsored = policy.takeSponsoredQuote(error);
    if (sponsored === undefined) {
      // The pinned SDK refuses a balance below the transfer plus its fee after reading it; APN names that refusal only
      // from its own two validated reads, never from the SDK's words.
      if (policy.usdcShortfall() !== undefined) mmFail("mm_gasless_balance");
      throw error;
    }
    if (resolverCalls !== 0 || hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
    phase.stage = "quote_output";
    return sponsored;
  }
  if (resolverCalls !== 0 || hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  phase.stage = "quote_output";
  return validateSdkQuote(raw, input, state.address);
}

async function buildUnsigned(input: Extract<HelperRequest, { mode: "buildUnsigned" }>["input"]): Promise<MetaMaskGaslessUnsignedResult> {
  const evm = await foxEvm();
  const controller = await ethereumControllers();
  mmChainFacts(input.chainId);
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

/** The answer check that refused a job answer, its job status token and how its `tx` compared, for a closed diagnostic. */
interface ResponseProgress { check: SubmitCheck | undefined; providerStatus: string | null; tx: MetaMaskJobTx | undefined }
interface SubmitProgress extends ResponseProgress { stage: SubmitStage }

async function submit(intent: MetaMaskGaslessProviderIntent, first: PrivateState, home: string, now: () => Date,
  policy: HelperNetworkPolicy, firstObservedAt: Date, sent: SubmitProgress): Promise<MetaMaskGaslessProviderObservation> {
  sent.stage = "sdk_load";
  const evm = await foxEvm();
  const keyrings = await foxKeyring();
  sent.stage = "hydrate";
  const firstHydrated = await hydrateSdkState(first);
  if (firstHydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  const { keyring } = await keyrings.createKeyringController({ mode: keyrings.KEYRING_KIND.SERVER,
    input: { baseUrl: SERVER_URL, authToken: first.token, projectId: first.projectId,
      wallets: firstHydrated.walletState.remoteWallets as never[] }, adapters: [(deps) => new evm.EvmServerAdapter(deps)], logLevel: "silent" });
  const adapter = evm.evmServerAdapter(keyring);
  sent.stage = "binding";
  const secondObservedAt = now();
  if (secondObservedAt.getTime() < firstObservedAt.getTime()) mmFail("mm_gasless_clock");
  const second = await readPrivateState(home, intent.binding, secondObservedAt);
  const secondHydrated = await hydrateSdkState(second);
  if (secondHydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  if (second.generationHash !== first.generationHash || second.projectId !== first.projectId || second.token !== first.token) {
    mmFail("mm_gasless_binding_changed");
  }
  sent.check = "deadline"; assertBeforeDeadline(intent.expiresAt, now()); sent.check = undefined;
  sent.stage = "body";
  const wireExecutions = evm.executionsToWire(intent.quote.executions.map((item) => ({ target: item.target, value: BigInt(item.value), callData: item.callData })));
  const wireDelegation = evm.unsignedDelegationToWire(intent.unsignedDelegation as never);
  const expectedBody = { requestId: intent.requestId, method: "eth_sendRelayTransaction", encoding: "redeemDelegations",
    tx: { from: intent.binding.address, chainId: intent.request.chainId }, executions: wireExecutions, delegation: wireDelegation };
  policy.setExpectedSubmitBody(expectedBody);
  sent.stage = "post";
  const status = await adapter.submitRelayTransaction({ from: intent.binding.address, chainId: intent.request.chainId,
    executions: wireExecutions, delegation: wireDelegation },
  { chainId: intent.request.chainId, origin: "apn", requestId: intent.requestId });
  sent.stage = "response";
  return providerObservation(status, intent, now(), "mm_gasless_submit_unknown", sent);
}

async function observe(intent: MetaMaskGaslessProviderIntent, state: PrivateState, policy: HelperNetworkPolicy,
  now: () => Date, seen: ResponseProgress): Promise<MetaMaskGaslessProviderObservation> {
  const evm = await foxEvm();
  const keyrings = await foxKeyring();
  const hydrated = await hydrateSdkState(state);
  if (hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  const { keyring } = await keyrings.createKeyringController({ mode: keyrings.KEYRING_KIND.SERVER,
    input: { baseUrl: SERVER_URL, authToken: state.token, projectId: state.projectId,
      wallets: hydrated.walletState.remoteWallets as never[] }, adapters: [(deps) => new evm.EvmServerAdapter(deps)], logLevel: "silent" });
  try {
    const status = await evm.evmServerAdapter(keyring).getJobStatus({ pollingId: intent.requestId, kind: evm.SIGN_REQUEST_KIND.TRANSACTION });
    return providerObservation(status, intent, now(), "mm_gasless_provider_unavailable", seen);
  } catch (error) {
    if (policy.didObserveNotFound()) return unavailable(intent, now());
    throw error;
  }
}

/**
 * A native transfer's server-wallet request, read as `observe` reads a gasless one: one `getJobStatus` GET by its exact
 * id, checked field by field (client/server-request.ts). A 404 is "not found", never an outcome.
 */
async function readServerRequest(query: MetaMaskServerRequestQuery, session: PrivateSession, policy: HelperNetworkPolicy,
  seen: ResponseProgress): Promise<MetaMaskServerRequestRead> {
  const evm = await foxEvm();
  const keyrings = await foxKeyring();
  const hydrated = await hydrateSdkState(session);
  if (hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  const { keyring } = await keyrings.createKeyringController({ mode: keyrings.KEYRING_KIND.SERVER,
    input: { baseUrl: SERVER_URL, authToken: session.token, projectId: session.projectId,
      wallets: hydrated.walletState.remoteWallets as never[] }, adapters: [(deps) => new evm.EvmServerAdapter(deps)], logLevel: "silent" });
  let status: unknown;
  try { status = await evm.evmServerAdapter(keyring).getJobStatus({ pollingId: query.requestId, kind: evm.SIGN_REQUEST_KIND.TRANSACTION }); }
  catch (error) {
    if (policy.didObserveNotFound()) return serverRequestNotFound(query);
    throw error;
  }
  if (hydrated.writes() !== 0) mmFail("mm_gasless_state_security");
  return serverRequestAnswer(status, query, policy.requestBodyHash(), session.session.authMethod, seen);
}

function validateSdkQuote(value: unknown, input: Extract<HelperRequest, { mode: "quote" }>["input"], owner: string): MetaMaskGaslessQuote {
  if (!isPlainRecord(value) || typeof value.amount !== "bigint" || value.amount !== mmUint(input.netAtomic, true) ||
    mmAddress(value.token, "mm_gasless_quote_invalid") !== input.token || mmAddress(value.recipient, "mm_gasless_quote_invalid") !== input.recipient ||
    mmAddress(value.feeToken, "mm_gasless_quote_invalid") !== input.token || typeof value.feeAmount !== "bigint" || value.feeAmount < 0n ||
    value.feeDecimals !== mmRegistry(input.chainId, input.token).row.decimals || typeof value.feeTokenSymbol !== "string" || value.feeTokenSymbol.length < 1 || value.feeTokenSymbol.length > 32 ||
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

function providerObservation(value: unknown, intent: MetaMaskGaslessProviderIntent, now: Date,
  reason: "mm_gasless_submit_unknown" | "mm_gasless_provider_unavailable", sent?: ResponseProgress): MetaMaskGaslessProviderObservation {
  // Each refusal names its check for the submit's or the observation's diagnostic; the conditions are one compound test.
  const refuse = (check: SubmitCheck): never => { if (sent !== undefined) sent.check = check; return mmFail(reason); };
  if (!isPlainRecord(value)) return refuse("response_body");
  if (value.requestId !== intent.requestId) return refuse("response_request_id");
  if (value.kind !== "transaction") return refuse("response_kind");
  if (typeof value.status !== "string") return refuse("response_status");
  if (!isPlainRecord(value.tx) || String(value.tx.from).toLowerCase() !== intent.binding.address || value.tx.chainId !== intent.request.chainId) {
    if (sent !== undefined) { sent.tx = jobTx(value.tx, intent); sent.providerStatus = submitToken(value.status); }
    return refuse("response_tx");
  }
  // The SDK preserves backend metadata. Extract only the bound observation fields;
  // approval details, links, signatures and any future metadata never leave this helper.
  if (value.txHash !== undefined && sent !== undefined) sent.check = "response_hash";
  const txHash = value.txHash === undefined ? null : mmHex(value.txHash, 32, reason);
  if (sent !== undefined) sent.check = undefined;
  const pending = ["EVALUATING", "SIGNING", "BROADCASTING"];
  const failed = ["FAILED", "BROADCAST_FAILED"];
  const unavailableStatuses = ["BROADCAST_TRACKING_EXPIRED", "CONFIRMATION_TRACKING_EXPIRED"];
  const status = value.status === "AWAITING_MFA" ? "awaiting_approval" : pending.includes(value.status) ? "pending" :
    value.status === "BROADCASTED" ? "broadcasted" :
    value.status === "CONFIRMED" ? "confirmed" : value.status === "DENIED" ? "denied" : value.status === "EXPIRED" ? "expired" :
      failed.includes(value.status) ? "failed" : unavailableStatuses.includes(value.status) ? "unavailable" : unknownStatus(value.status, sent, reason);
  return { observedAt: now.toISOString(), requestIdHash: mmPrivateHash("request-id", intent.requestId), status, txHash };
}
/** A job status APN does not know refuses; the submit's or observation's diagnostic keeps it when it is a token. */
function unknownStatus(status: string, sent: ResponseProgress | undefined, reason: "mm_gasless_submit_unknown" | "mm_gasless_provider_unavailable"): never {
  if (sent !== undefined) { sent.check = "response_status"; sent.providerStatus = submitToken(status); }
  return mmFail(reason);
}
function unavailable(intent: MetaMaskGaslessProviderIntent, now: Date): MetaMaskGaslessProviderObservation {
  return { observedAt: now.toISOString(), requestIdHash: mmPrivateHash("request-id", intent.requestId), status: "unavailable", txHash: null };
}
function assertBeforeDeadline(value: string, now: Date): void {
  const expires = Date.parse(value), current = now.getTime();
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(current) || current >= expires) mmFail("mm_gasless_expired");
}
function fallback(mode: HelperRequest["mode"]) {
  return helperSends(mode) ? "mm_gasless_submit_unknown" as const : mode === "buildUnsigned" ?
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
