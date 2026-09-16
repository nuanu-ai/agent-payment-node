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
import { rpcAddress, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord, recheckBlock,
  type GaslessRpcCall, type GaslessRpcMethod } from "./rpc-codec.js";
import { readAccountAt, readFeeConfigurationAt, verifyProtocolAt } from "./rpc-state.js";
import { bundlerGasPrices } from "./rpc-gas-prices.js";
import { gaslessDeployment, gaslessIntentAsset, gaslessProtocolHash } from "./registry.js";
import { GASLESS_ESTIMATE_SIGNATURE, verifyGaslessBootstrap, verifyGaslessUserOperation } from "./signature.js";
import { assertGaslessExecutionChain, gaslessChain, gaslessFailure } from "./validation.js";
import { gaslessUserOperation, gaslessUserOperationHash, validateGaslessWire } from "./wire.js";

const RPC_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
  "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_maxPriorityFeePerGas",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const BUNDLER_METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationReceipt", "eth_getUserOperationByHash"]);
const MAX_RESPONSE = 2 * 1024 * 1024;

export function gaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>): GaslessRpcFactory {
  const cache = new Map<GaslessChainId, GaslessRpcPort>(), transport = new GaslessHttps();
  return (chainId) => {
    const selected = gaslessChain(chainId, "APN_RPC_CONFIG"), existing = cache.get(selected);
    if (existing !== undefined) return existing;
    const deployment = gaslessDeployment(selected), rpcUrl = environment[deployment.rpcEnv];
    if (rpcUrl === undefined || rpcUrl.length === 0) gaslessFailure("APN_RPC_CONFIG", `missing_${deployment.rpcEnv}`);
    const configuredBundler = environment[deployment.bundlerEnv];
    const rpc = new GaslessRpc(selected, rpcUrl, configuredBundler === undefined || configuredBundler.length === 0
      ? undefined : configuredBundler, transport);
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

  constructor(chainId: GaslessChainId, rpcUrl: string, bundlerUrl?: string,
    private readonly transport: GaslessTransport = new GaslessHttps()) {
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
    if (rpcQuantity(rpcChain) !== BigInt(this.chainId) || rpcQuantity(bundlerChain) !== BigInt(this.chainId)) {
      gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    }
    if (!Array.isArray(supported) || supported.length < 1 || supported.length > 16 ||
      !supported.some((value) => {
        try { return rpcAddress(value) === this.deployment.entryPoint; } catch { return false; }
      })) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_entrypoint_unavailable");
  }

  async snapshot(owner: Address, approvedGas?: GaslessGas): Promise<GaslessSnapshot> {
    const [rpcChain, bundler] = await Promise.all([this.rpcCall("eth_chainId", []), this.bundlerState()]);
    this.validateChain(rpcChain, bundler[0], bundler[1]);
    const at = await rpcBlock(this.rpcCall, "latest");
    const [account, feeConfiguration, priority] = await Promise.all([
      readAccountAt(this.rpcCall, this.deployment, owner, at.block, true),
      readFeeConfigurationAt(this.rpcCall, this.deployment, owner, at.block),
      this.rpcCall("eth_maxPriorityFeePerGas", []),
      verifyProtocolAt(this.rpcCall, this.deployment, at.block),
    ]).then(([accountState, configuration, priorityFee]) => [accountState, configuration, priorityFee] as const);
    if (account.pendingEoaNonceAtomic !== account.eoaNonceAtomic) {
      gaslessFailure("APN_OPERATION_BLOCKED", "gasless_nonce_drift");
    }
    const prices = bundlerGasPrices(bundler[2], at.raw.baseFeePerGas, priority, approvedGas);
    await recheckBlock(this.rpcCall, at.block);
    return { chainId: this.chainId, rpcOrigin: this.rpcOrigin, rpcEndpointHash: this.rpcEndpointHash,
      bundlerOrigin: this.bundlerOrigin, bundlerEndpointHash: this.bundlerEndpointHash, block: at.block,
      protocolHash: gaslessProtocolHash(this.deployment), owner: account.owner, token: this.deployment.token,
      balanceAtomic: account.balanceAtomic, nativeBalanceWei: account.nativeBalanceWei,
      allowanceAtomic: account.allowanceAtomic, permitNonceAtomic: account.permitNonceAtomic,
      entryPointNonceAtomic: account.entryPointNonceAtomic, eoaNonceAtomic: account.eoaNonceAtomic,
      pendingEoaNonceAtomic: account.pendingEoaNonceAtomic, delegation: account.delegation, feeConfiguration, ...prices };
  }

  /** One bounded, read-only HTTP batch; no effect call can enter this batch. */
  private async bundlerState(): Promise<readonly unknown[]> {
    const methods = ["eth_chainId", "eth_supportedEntryPoints", "pimlico_getUserOperationGasPrice"] as const;
    const requests = methods.map(method => ({ jsonrpc: "2.0", id: (++this.sequence).toString(), method, params: [] }));
    let response;
    try { response = await this.transport.request(this.bundlerEndpoint, "POST", canonicalJson(requests),
      MAX_RESPONSE, "APN_RPC_CONFIG"); }
    catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable."); }
    if (response.status !== 200) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
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

  async mirrorEstimate(intent: GaslessIntent, fees?: GaslessFees): Promise<GaslessEstimate> {
    assertGaslessExecutionChain(this.chainId);
    const asset = this.assertIntent(intent);
    // Proved before any use: the row's balance-layout claim must reproduce the owner's own snapshot balance on chain.
    const slot = await this.provenBalanceSlot(asset, intent);
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
    await this.assertChain();
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

  async send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial): Promise<Hex> {
    assertGaslessExecutionChain(this.chainId);
    this.assertIntent(intent);
    const wire = validateGaslessWire(intent, sealed.userOperation);
    const localHash = gaslessUserOperationHash(intent, wire);
    if (sealed.userOperationHash !== localHash || await verifyGaslessUserOperation(intent, wire) !== localHash) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
    }
    await this.assertChain();
    try {
      const returned = rpcHex(await this.bundlerCall("eth_sendUserOperation", [wire, intent.entryPoint]), 32, 32);
      if (returned !== localHash) throw new Error("hash");
      return returned;
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless submission state is unknown."); }
  }

  async observe(intent: GaslessIntent, identity: GaslessEffectIdentity,
    cursor: GaslessCursor): Promise<GaslessObservation> {
    this.assertIntent(intent);
    const rpcChain = await this.rpcCall("eth_chainId", []);
    if (rpcQuantity(rpcChain) !== BigInt(this.chainId)) gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
    return await observeGasless({ chainId: this.chainId, rpcOrigin: this.rpcOrigin, deployment: this.deployment,
      rpc: this.rpcCall, bundler: this.bundlerCall }, intent, identity, cursor);
  }

  /** Returns the admitted asset the intent names, so no caller has to re-derive it from a literal. */
  private assertIntent(intent: GaslessIntent): GaslessAsset {
    if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
      intent.initialSnapshot.rpcOrigin !== this.rpcOrigin || intent.initialSnapshot.rpcEndpointHash !== this.rpcEndpointHash ||
      intent.initialSnapshot.bundlerOrigin !== this.bundlerOrigin || intent.initialSnapshot.bundlerEndpointHash !== this.bundlerEndpointHash) {
      gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
    }
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
   * claimed slot must equal the balance the frozen snapshot already read through `balanceOf` at that exact block.
   * A row with no claim, a claim for another implementation, a zero witness balance or any disagreement fails closed
   * rather than fabricating a balance at an unverified slot.
   */
  private async provenBalanceSlot(asset: GaslessAsset, intent: GaslessIntent): Promise<string> {
    const layout = asset.balanceLayout;
    if (layout === null) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_balance_layout_unknown");
    if (layout.implementationHash !== asset.implementationHash) {
      gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_stale");
    }
    const witness = BigInt(intent.initialSnapshot.balanceAtomic);
    if (witness === 0n) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_unproven");
    const observed = rpcWord(await this.rpcCall("eth_getStorageAt", [asset.token,
      gaslessBalanceSlot(intent.owner.address, layout.mappingSlotAtomic),
      { blockHash: intent.initialSnapshot.block.hash, requireCanonical: true }]));
    if (observed !== witness) gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_mismatch");
    return layout.mappingSlotAtomic;
  }

  private async call(which: "rpc" | "bundler", method: GaslessRpcMethod, params: readonly unknown[],
    transport: GaslessTransport): Promise<unknown> {
    const methods = which === "rpc" ? RPC_METHODS : BUNDLER_METHODS;
    if (!methods.has(method)) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_method");
    const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response: { readonly status: number; readonly body: string };
    try {
      response = await transport.request(which === "rpc" ? this.rpcEndpoint : this.bundlerEndpoint,
        "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG");
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable."); }
    if (response.status !== 200) gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
    const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    const keys = result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, keys)) {
      gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
    }
    if (error) gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
    return record.result;
  }
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
