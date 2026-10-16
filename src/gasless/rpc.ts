import { AsyncLocalStorage } from "node:async_hooks";
import { encodeAbiParameters, keccak256, numberToHex } from "viem";
import { canonicalJson, exactKeys, hashObject, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address, Hex } from "../model.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { gaslessMirrorBootstrap } from "./custody.js";
import { assertGaslessEstimate } from "./economics.js";
import { GaslessHttps, type GaslessTransport } from "./https.js";
import type { GaslessAsset, GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessEstimate, GaslessFees, GaslessGas,
  GaslessIntent, GaslessObservation, GaslessSnapshot } from "./model.js";
import type { GaslessBootstrapMaterial, GaslessRpcFactory, GaslessRpcPort, GaslessUserOperationMaterial } from "./ports.js";
import { observeGasless } from "./rpc-observe.js";
import { quantity, rpcAddress, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord, sameBlock,
  type GaslessRpcCall, type GaslessRpcMethod } from "./rpc-codec.js";
import { readAccountAt, readFeeConfigurationAt, verifyProtocolAt } from "./rpc-state.js";
import { gaslessPostBudget, type GaslessInvocationPlan } from "./rpc-budget.js";
import { assertBundlerFeesCover, bundlerGasPrices } from "./rpc-gas-prices.js";
import { gaslessDeployment, gaslessIntentAsset, gaslessProtocolHash } from "./registry.js";
import { GASLESS_ESTIMATE_SIGNATURE, verifyGaslessBootstrap, verifyGaslessUserOperation } from "./signature.js";
import { assertGaslessExecutionChain, gaslessChain, gaslessFailure } from "./validation.js";
import { gaslessUserOperation, gaslessUserOperationHash, validateGaslessWire } from "./wire.js";
import { gaslessBatchCap, gaslessConfigError, validBatchCap } from "./rpc-config.js";
export { gaslessBatchCap, gaslessBatchCapSetting, gaslessConfigError } from "./rpc-config.js";

const RPC_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
  "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_maxPriorityFeePerGas",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const BUNDLER_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationReceipt", "eth_getUserOperationByHash"]);
const MAX_RESPONSE = 2 * 1024 * 1024;
const invocation = new AsyncLocalStorage<GaslessRpcRequestSession>();

/** One command invocation includes RPC and bundler POSTs, including failed transport attempts. */
export class GaslessRpcRequestSession {
  private posts = 0;
  private terminalStatus: number | null = null;
  private readonly verifiedChains = new Set<GaslessRpc>();
  private readonly protocolAnchors = new Map<GaslessRpc, { hash: Hex; proof: Promise<void> }>();
  private readonly provenCode = new Set<object>();
  private batchCap: number;
  private postCap: number;
  constructor(private readonly plan: GaslessInvocationPlan, maxBatchItems?: number) {
    if (maxBatchItems !== undefined && !validBatchCap(maxBatchItems)) gaslessFailure("APN_INVALID_INPUT", "gasless_RPC_batch_cap");
    this.batchCap = maxBatchItems ?? Number.POSITIVE_INFINITY;
    this.postCap = gaslessPostBudget(plan, this.batchCap);
  }
  get maxBatchItems(): number { return this.batchCap; }
  /** Derived from the invocation's step plan (`rpc-budget.ts`) and batch cap, including its explicit retry allowance. */
  get maxPosts(): number { return this.postCap; }
  /**
   * An endpoint's own batch cap (`APN_<NETWORK>_RPC_MAX_BATCH_ITEMS`) tightens this invocation before its reads are
   * split; the POST budget is re-derived from the same step plan at that cap, so the split is counted, never exceeded.
   */
  limitBatch(cap: number | undefined): void {
    if (cap === undefined || cap >= this.batchCap) return;
    this.batchCap = cap; this.postCap = gaslessPostBudget(this.plan, cap);
  }
  reserve(): void {
    this.assertActive();
    if (this.posts >= this.maxPosts) gaslessFailure("APN_RPC_BUDGET_EXCEEDED", "gasless_RPC_request_budget");
    this.posts += 1;
  }
  assertActive(): void {
    if (this.terminalStatus !== null) this.rejectHttp(this.terminalStatus);
  }
  rejectHttp(status: number): never {
    this.terminalStatus = status;
    if (status === 429) return gaslessFailure("APN_RPC_RATE_LIMITED", "gasless_RPC_HTTP_429");
    return gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
  }
  hasVerifiedChain(rpc: GaslessRpc): boolean { return this.verifiedChains.has(rpc); }
  verifyChain(rpc: GaslessRpc): void { this.verifiedChains.add(rpc); }
  /** True once this invocation verified the pinned code hashes through `source`; code at those addresses is immutable. */
  codeProven(source: object): boolean { return this.provenCode.has(source); }
  proveCode(source: object): void { this.provenCode.add(source); }
  protocolAt(rpc: GaslessRpc, hash: Hex, verify: (withCode: boolean) => Promise<void>): Promise<void> {
    const cached = this.protocolAnchors.get(rpc);
    if (cached?.hash === hash) return cached.proof;
    // A changed latest anchor requires fresh proxy and identity reads before the next effect gate; the immutable code
    // bytes are downloaded and hashed only by this invocation's first protocol proof.
    const withCode = !this.codeProven(rpc);
    const proof = verify(withCode).then(() => { if (withCode) this.proveCode(rpc); });
    this.protocolAnchors.set(rpc, { hash, proof });
    void proof.catch(() => { if (this.protocolAnchors.get(rpc)?.proof === proof) this.protocolAnchors.delete(rpc); });
    return proof;
  }
}

interface PendingRead {
  readonly id: string;
  readonly method: GaslessRpcMethod;
  readonly params: readonly unknown[];
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/** Wrap a public APN command so a reused RPC factory receives a fresh budget derived from the command's plan. */
export async function withGaslessRpcInvocation<T>(work: () => Promise<T>, plan: GaslessInvocationPlan,
  maxBatchItems?: number): Promise<T> {
  return await invocation.run(new GaslessRpcRequestSession(plan, maxBatchItems), work);
}

/** Reuse the public command's budget, or start one observation step for a directly invoked observation port. */
export async function withinGaslessRpcInvocation<T>(work: () => Promise<T>): Promise<T> {
  return invocation.getStore() === undefined ? await withGaslessRpcInvocation(work, "observe") : await work();
}

export function gaslessRpcInvocation(): GaslessRpcRequestSession {
  const session = invocation.getStore();
  if (session === undefined) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_invocation_missing");
  return session;
}

/** `rpcSetting` names where the RPC URL came from when it is not the chain's own `APN_*_RPC_URL` (quote: `--rpc-url`). */
export function gaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>,
  rpcSetting?: string): GaslessRpcFactory {
  const cache = new Map<GaslessChainId, GaslessRpcPort>(), transport = new GaslessHttps();
  const fallbackSession = new GaslessRpcRequestSession("observe");
  return (chainId) => {
    const selected = gaslessChain(chainId, "APN_RPC_CONFIG"), existing = cache.get(selected);
    if (existing !== undefined) return existing;
    const deployment = gaslessDeployment(selected), rpcUrl = environment[deployment.rpcEnv];
    const setting = rpcSetting ?? deployment.rpcEnv;
    if (rpcUrl === undefined || rpcUrl.length === 0) {
      throw gaslessConfigError(`missing_${deployment.rpcEnv}`, `Set ${setting} to a public HTTPS ${deployment.network} RPC endpoint.`);
    }
    const configuredBundler = environment[deployment.bundlerEnv];
    guidedEndpoint(rpcUrl, `${deployment.network} RPC`, setting);
    if (configuredBundler !== undefined && configuredBundler.length > 0) {
      guidedEndpoint(configuredBundler, `${deployment.network} bundler`, deployment.bundlerEnv);
    }
    const rpc = new GaslessRpc(selected, rpcUrl, configuredBundler === undefined || configuredBundler.length === 0
      ? undefined : configuredBundler, transport, fallbackSession, gaslessBatchCap(environment, deployment.rpcEnv));
    cache.set(selected, rpc);
    return rpc;
  };
}

export class GaslessRpc implements GaslessRpcPort {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  readonly bundlerOrigin: string;
  readonly bundlerEndpointHash: string;
  private readonly rpcEndpoint: string;
  private readonly bundlerEndpoint: string;
  private readonly deployment;
  private sequence = 0n;
  private readonly rpcCall: GaslessRpcCall;
  private readonly bundlerCall: GaslessRpcCall;
  private readonly pendingReads = new Map<GaslessRpcRequestSession, PendingRead[]>();

  constructor(chainId: GaslessChainId, rpcUrl: string, bundlerUrl?: string,
    private readonly transport: GaslessTransport = new GaslessHttps(),
    private readonly fallbackSession: GaslessRpcRequestSession = new GaslessRpcRequestSession("observe"),
    private readonly maxBatchItems?: number) {
    if (maxBatchItems !== undefined && !validBatchCap(maxBatchItems)) gaslessFailure("APN_RPC_CONFIG", "gasless_RPC_batch_cap");
    this.chainId = gaslessChain(chainId, "APN_RPC_CONFIG");
    this.deployment = gaslessDeployment(this.chainId);
    const rpc = endpoint(rpcUrl), bundler = endpoint(bundlerUrl ?? this.deployment.publicBundlerUrl);
    this.rpcEndpoint = rpc.toString(); this.bundlerEndpoint = bundler.toString();
    this.rpcOrigin = rpc.origin; this.bundlerOrigin = bundler.origin;
    this.rpcEndpointHash = sha256(this.rpcEndpoint); this.bundlerEndpointHash = sha256(this.bundlerEndpoint);
    this.rpcCall = async (method, params) => await this.call("rpc", method, params, this.transport);
    this.bundlerCall = async (method, params) => await this.call("bundler", method, params, this.transport);
  }

  async assertChain(): Promise<void> {
    const [rpcChain, bundlerChain, supported] = await Promise.all([
      this.rpcCall("eth_chainId", []), this.bundlerCall("eth_chainId", []),
      this.bundlerCall("eth_supportedEntryPoints", []),
    ]);
    this.validateChain(rpcChain, bundlerChain, supported);
  }

  private validateChain(rpcChain: unknown, bundlerChain: unknown, supported: unknown): void {
    if (rpcQuantity(rpcChain) !== BigInt(this.chainId)) gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    this.validateBundler(bundlerChain, supported);
  }

  private validateBundler(bundlerChain: unknown, supported: unknown): void {
    if (rpcQuantity(bundlerChain) !== BigInt(this.chainId)) gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    if (!Array.isArray(supported) || supported.length < 1 || supported.length > 16 ||
      !supported.some((value) => {
        try { return rpcAddress(value) === this.deployment.entryPoint; } catch { return false; }
      })) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_entrypoint_unavailable");
  }

  async snapshot(owner: Address, approvedGas?: GaslessGas): Promise<GaslessSnapshot> {
    const session = invocation.getStore() ?? this.fallbackSession;
    // The latest anchor is read in the same read-only batch as the chain identity.
    const [rpcChain, bundler, at] = await Promise.all([
      this.rpcCall("eth_chainId", []), this.bundlerState(), rpcBlock(this.rpcCall, "latest"),
    ]);
    this.validateChain(rpcChain, bundler[0], bundler[1]);
    // Every state read is pinned to the anchor by hash with requireCanonical; the anchor's header is re-read by number
    // in the same request, so a reorganised anchor still fails closed without a separate recheck POST.
    const [account, feeConfiguration, priority, , again] = await Promise.all([
      readAccountAt(this.rpcCall, this.deployment, owner, at.block, true),
      readFeeConfigurationAt(this.rpcCall, this.deployment, owner, at.block),
      this.rpcCall("eth_maxPriorityFeePerGas", []),
      session.protocolAt(this, at.block.hash, async (withCode) =>
        await verifyProtocolAt(this.rpcCall, this.deployment, at.block, withCode)),
      rpcBlock(this.rpcCall, quantity(BigInt(at.block.numberAtomic))),
    ]);
    if (!sameBlock(again.block, at.block)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_reorg");
    if (account.pendingEoaNonceAtomic !== account.eoaNonceAtomic) {
      gaslessFailure("APN_OPERATION_BLOCKED", "gasless_nonce_drift");
    }
    const prices = bundlerGasPrices(bundler[2], at.raw.baseFeePerGas, priority, approvedGas);
    session.verifyChain(this);
    return { chainId: this.chainId, rpcOrigin: this.rpcOrigin, rpcEndpointHash: this.rpcEndpointHash,
      bundlerOrigin: this.bundlerOrigin, bundlerEndpointHash: this.bundlerEndpointHash, block: at.block,
      protocolHash: gaslessProtocolHash(this.deployment), owner: account.owner, token: this.deployment.token,
      balanceAtomic: account.balanceAtomic, nativeBalanceWei: account.nativeBalanceWei,
      allowanceAtomic: account.allowanceAtomic, permitNonceAtomic: account.permitNonceAtomic,
      entryPointNonceAtomic: account.entryPointNonceAtomic, eoaNonceAtomic: account.eoaNonceAtomic,
      pendingEoaNonceAtomic: account.pendingEoaNonceAtomic, delegation: account.delegation, feeConfiguration, ...prices };
  }

  async assertSignedFees(fees: GaslessFees): Promise<void> {
    assertGaslessExecutionChain(this.chainId);
    const [bundlerChain, supported, prices] = await this.bundlerState();
    this.validateBundler(bundlerChain, supported);
    assertBundlerFeesCover(prices, fees);
  }

  /** One bounded, read-only HTTP batch; no effect call can enter this batch. */
  private async bundlerState(): Promise<readonly unknown[]> {
    const methods = ["eth_chainId", "eth_supportedEntryPoints", "pimlico_getUserOperationGasPrice"] as const;
    const requests = methods.map(method => ({ jsonrpc: "2.0", id: (++this.sequence).toString(), method, params: [] }));
    let response;
    const session = invocation.getStore() ?? this.fallbackSession;
    session.reserve();
    try { response = await this.transport.request(this.bundlerEndpoint, "POST", canonicalJson(requests),
      MAX_RESPONSE, "APN_RPC_CONFIG", () => session.assertActive()); }
    catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable."); }
    assertHttpStatus(response.status, session);
    const rows = rpcJson(response.body, MAX_RESPONSE);
    if (!Array.isArray(rows) || rows.length !== requests.length) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
    const results = new Map<string, unknown>();
    for (const value of rows) {
      const row = rpcRecord(value), id = row.id;
      const result = Object.hasOwn(row, "result"), error = Object.hasOwn(row, "error");
      if (typeof id !== "string" || !requests.some(request => request.id === id) || results.has(id) ||
        row.jsonrpc !== "2.0" || result === error ||
        !exactKeys(row, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
      }
      if (error) gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
      results.set(id, row.result);
    }
    return requests.map(request => results.get(request.id));
  }

  async mirrorEstimate(intent: GaslessIntent, witness: GaslessSnapshot, fees?: GaslessFees): Promise<GaslessEstimate> {
    assertGaslessExecutionChain(this.chainId);
    const asset = this.assertIntent(intent);
    // Proved before any use: the row's balance-layout claim must reproduce the owner's balance from a fresh snapshot.
    const slot = await this.provenBalanceSlot(asset, intent, witness);
    // One bounded request: the guard snapshot before it already proved both endpoint chains and EntryPoint support.
    const mirror = await gaslessMirrorBootstrap(intent);
    const wire = gaslessUserOperation(mirror.intent, mirror, GASLESS_ESTIMATE_SIGNATURE, fees);
    const override = { [intent.token]: { stateDiff: { [gaslessBalanceSlot(mirror.intent.owner.address, slot)]:
      numberToHex(BigInt(intent.request.grossAtomic), { size: 32 }) } } };
    let raw: Record<string, unknown>;
    try { raw = rpcRecord(await this.bundlerCall("eth_estimateUserOperationGas", [wire, intent.entryPoint, override])); }
    catch { return gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_mirror_estimate_unavailable"); }
    const fields = ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
      "paymasterPostOpGasLimit", "preVerificationGas"] as const;
    if (!exactKeys(raw, fields)) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_mirror_estimate_unavailable");
    const bounded = Object.fromEntries(fields.map((field) => [field, rpcQuantity(raw[field]).toString()])) as unknown as
      Omit<GaslessEstimate, "responseHash">;
    const estimate = { ...bounded, responseHash: hashObject(bounded) };
    try { assertGaslessEstimate(intent, estimate); }
    catch { gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_mirror_estimate_bounds"); }
    return estimate;
  }

  async estimate(intent: GaslessIntent, bootstrap: GaslessBootstrapMaterial, fees?: GaslessFees): Promise<GaslessEstimate> {
    assertGaslessExecutionChain(this.chainId);
    this.assertIntent(intent);
    await verifyGaslessBootstrap(intent, { permitSignature: bootstrap.permitSignature, authorization: bootstrap.authorization });
    await this.assertChainUnlessVerified();
    const wire = gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE, fees);
    validateGaslessWire(intent, wire);
    const raw = rpcRecord(await this.bundlerCall("eth_estimateUserOperationGas", [wire, intent.entryPoint]));
    const fields = ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
      "paymasterPostOpGasLimit", "preVerificationGas"] as const;
    if (!exactKeys(raw, fields)) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_estimate_bounds");
    const bounded = Object.fromEntries(fields.map((field) => [field, rpcQuantity(raw[field]).toString()])) as unknown as
      Omit<GaslessEstimate, "responseHash">;
    const estimate = { ...bounded, responseHash: hashObject(bounded) };
    assertGaslessEstimate(intent, estimate);
    return estimate;
  }

  async send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial, beforeSend?: () => void): Promise<Hex> {
    assertGaslessExecutionChain(this.chainId);
    this.assertIntent(intent);
    const wire = validateGaslessWire(intent, sealed.userOperation);
    const localHash = gaslessUserOperationHash(intent, wire);
    if (sealed.userOperationHash !== localHash || await verifyGaslessUserOperation(intent, wire) !== localHash) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
    }
    await this.assertChainUnlessVerified();
    try {
      const returned = rpcHex(await this.call("bundler", "eth_sendUserOperation", [wire, intent.entryPoint], this.transport, beforeSend), 32, 32);
      if (returned !== localHash) throw new Error("hash");
      return returned;
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless submission state is unknown."); }
  }

  /**
   * Observation proves an effect APN already sent, so it reads the addresses and protocol hash saved in the intent and
   * never today's registry pins: a later pin update cannot strand an operation that was sent under the earlier set.
   */
  async observe(intent: GaslessIntent, identity: GaslessEffectIdentity,
    cursor: GaslessCursor): Promise<GaslessObservation> {
    this.assertEndpoint(intent);
    const session = invocation.getStore() ?? this.fallbackSession;
    if (!session.hasVerifiedChain(this)) {
      const rpcChain = await this.rpcCall("eth_chainId", []);
      if (rpcQuantity(rpcChain) !== BigInt(this.chainId)) gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    }
    return await observeGasless({ chainId: this.chainId, rpcOrigin: this.rpcOrigin,
      rpc: this.rpcCall, bundler: this.bundlerCall }, intent, identity, cursor);
  }

  private async assertChainUnlessVerified(): Promise<void> {
    if (!(invocation.getStore() ?? this.fallbackSession).hasVerifiedChain(this)) await this.assertChain();
  }

  private assertEndpoint(intent: GaslessIntent): void {
    if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
      intent.initialSnapshot.rpcOrigin !== this.rpcOrigin || intent.initialSnapshot.rpcEndpointHash !== this.rpcEndpointHash ||
      intent.initialSnapshot.bundlerOrigin !== this.bundlerOrigin || intent.initialSnapshot.bundlerEndpointHash !== this.bundlerEndpointHash) {
      gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
    }
  }

  /** Returns the admitted asset the intent names, so no caller has to re-derive it from a literal. */
  private assertIntent(intent: GaslessIntent): GaslessAsset {
    this.assertEndpoint(intent);
    const asset = gaslessIntentAsset(intent);
    if (intent.entryPoint !== this.deployment.entryPoint || intent.delegate !== this.deployment.delegate ||
      intent.initialSnapshot.protocolHash !== gaslessProtocolHash(this.deployment)) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
    }
    return asset;
  }

  /**
   * The row's `balanceLayout` is a claim about one token implementation's storage, never protocol knowledge, so it is
   * proved twice before it is trusted. First the claim must name the implementation this chain is verified to run, so
   * a layout description can never outlive the code it describes. Then it is measured: the owner's balance word at the
   * claimed slot must equal the balance the guard snapshot just read through `balanceOf` at that exact recent block
   * (never the prepare block, whose state a keyless node may already have pruned).
   * A row with no claim, a claim for another implementation, a zero witness balance or any disagreement fails closed
   * rather than fabricating a balance at an unverified slot.
   */
  private async provenBalanceSlot(asset: GaslessAsset, intent: GaslessIntent, snapshot: GaslessSnapshot): Promise<string> {
    const layout = asset.balanceLayout;
    if (layout === null) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_balance_layout_unknown");
    if (layout.implementationHash !== asset.implementationHash) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_stale");
    }
    if (snapshot.chainId !== this.chainId || snapshot.rpcEndpointHash !== this.rpcEndpointHash ||
      snapshot.owner !== intent.owner.address || snapshot.token !== asset.token) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_unproven");
    }
    const witness = BigInt(snapshot.balanceAtomic);
    if (witness === 0n) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_unproven");
    const observed = rpcWord(await this.rpcCall("eth_getStorageAt", [asset.token,
      gaslessBalanceSlot(intent.owner.address, layout.mappingSlotAtomic),
      { blockHash: snapshot.block.hash, requireCanonical: true }]));
    if (observed !== witness) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_mismatch");
    return layout.mappingSlotAtomic;
  }

  private async call(which: "rpc" | "bundler", method: GaslessRpcMethod, params: readonly unknown[],
    transport: GaslessTransport, beforeSend?: () => void): Promise<unknown> {
    const methods = which === "rpc" ? RPC_METHODS : BUNDLER_METHODS;
    if (!methods.has(method)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_method");
    const id = (++this.sequence).toString();
    const session = invocation.getStore() ?? this.fallbackSession;
    if (which === "rpc") return await this.queueRead({ id, method, params }, session);
    const body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    session.reserve();
    let response: { readonly status: number; readonly body: string };
    try {
      response = await transport.request(this.bundlerEndpoint,
        "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG", () => { session.assertActive(); beforeSend?.(); });
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable."); }
    assertHttpStatus(response.status, session);
    const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    const keys = result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, keys)) {
      gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
    }
    if (error) gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
    return record.result;
  }

  /** Same-turn read calls share one physical POST; invocation sessions never share a batch. */
  private queueRead(read: Pick<PendingRead, "id" | "method" | "params">,
    session: GaslessRpcRequestSession): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const pending = this.pendingReads.get(session);
      const row: PendingRead = { ...read, resolve, reject };
      if (pending !== undefined) { pending.push(row); return; }
      this.pendingReads.set(session, [row]);
      queueMicrotask(() => { void this.flushReads(session); });
    });
  }

  private async flushReads(session: GaslessRpcRequestSession): Promise<void> {
    const reads = this.pendingReads.get(session);
    if (reads === undefined) return;
    this.pendingReads.delete(session);
    try {
      session.limitBatch(this.maxBatchItems);
      const results = new Map<string, unknown>();
      for (let start = 0; start < reads.length; start += session.maxBatchItems) {
        const chunk = reads.slice(start, start + session.maxBatchItems);
        session.reserve();
        const requests = chunk.map(({ id, method, params }) => ({ jsonrpc: "2.0", id, method, params }));
        const response = await this.transport.request(this.rpcEndpoint, "POST",
          canonicalJson(requests.length === 1 ? requests[0] : requests), MAX_RESPONSE, "APN_RPC_CONFIG",
          () => session.assertActive());
        assertHttpStatus(response.status, session);
        if (chunk.length === 1) {
          results.set(chunk[0]!.id, parseRpcResult(rpcRecord(rpcJson(response.body, MAX_RESPONSE)), chunk[0]!.id));
          continue;
        }
        const rows = rpcJson(response.body, MAX_RESPONSE);
        if (!Array.isArray(rows) || rows.length !== chunk.length) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
        const expected = new Set(chunk.map(row => row.id));
        for (const value of rows) {
          const record = rpcRecord(value), id = record.id;
          if (typeof id !== "string" || !expected.has(id) || results.has(id)) {
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
          }
          results.set(id, parseRpcResult(record, id));
        }
      }
      for (const read of reads) read.resolve(results.get(read.id));
    } catch (error) {
      const safe = error instanceof ApnError ? error : new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable.");
      for (const read of reads) read.reject(safe);
    }
  }
}

function parseRpcResult(record: Record<string, unknown>, id: string): unknown {
  const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
  const keys = result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
  if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, keys)) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
  }
  if (error) gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
  return record.result;
}

function assertHttpStatus(status: number, session: GaslessRpcRequestSession): void {
  if (status !== 200) session.rejectHttp(status);
}

/** Storage key of a Solidity `mapping(address => uint256)` entry at the given base slot. */
export function gaslessBalanceSlot(holder: Address, base: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BigInt(base)]));
}

function endpoint(value: string): URL {
  const parsed = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Gasless RPC endpoint", 2048);
  if (parsed.search !== "" || parsed.hash !== "") gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
  return parsed;
}


function guidedEndpoint(value: string, endpointName: string, setting: string): void {
  try { endpoint(value); } catch (error) {
    if (!(error instanceof ApnError) || error.code !== "APN_RPC_CONFIG") throw error;
    const query = error.message.includes("gasless_endpoint_identity");
    throw new ApnError("APN_RPC_CONFIG", error.message, { nextActions: [query
      ? `Remove the query string or fragment from ${setting}: APN binds the ${endpointName} endpoint by its exact URL.`
      : `Set ${setting} to a public, credential-free HTTPS ${endpointName} endpoint.`] });
  }
}
