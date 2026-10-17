import { assertBridgePhysicalGrant, type BridgeAuthorityCheck } from "./effect-authority.js";
import { encodeFunctionData, keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { evmRpcHex, evmRpcQuantity } from "../evm-rpc-codec.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import { bridgeAssetRow, bridgeChain } from "./asset-registry.js";
import type { BridgeChainId } from "./chains.js";
import { bridgeDeploymentCheck, bridgeDeploymentCheckIdentity, bridgeDeploymentCheckItems } from "./deployment-check.js";
import type { BridgeBlock, BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeObservationOptions, BridgeRpcPort } from "./ports.js";
import { bridgeFeeQuote, rpcBlockValue, rpcExpectedChainValue, rpcFeeBlockValue, rpcQuantityValue, rpcTransactionInput, rpcWordValue } from "./rpc-batch-codec.js";
import { ERC20_READ, GAS_ORACLE, GAS_ORACLE_ABI, L1_BLOCK } from "./rpc-deployment.js";
import { type BridgeBatchCall, type BridgeObservationContext, observeCanonical } from "./rpc-observation.js";
import type { RpcBatchReadItem, RpcReadSession } from "./rpc-session.js";
import { quantity, submitDirect } from "./rpc-support.js";
import { bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";

type PlannedRead = Omit<RpcBatchReadItem, "batchAttempt">;
const L1_UPPER_BOUND = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [16384n] });
const chainItem = (chainId: BridgeChainId): PlannedRead => ({ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(chainId) });
const latestCall = (to: Address, data: Hex): PlannedRead => ({ method: "eth_call", params: [{ to, data }, "latest"], cachePolicy: "none", decoder: rpcWordValue });
function blockOf(raw: Record<string, unknown>): BridgeBlock {
  return { numberAtomic: evmRpcQuantity(raw.number).toString(), hash: evmRpcHex(raw.hash, 32), timestampAtomic: evmRpcQuantity(raw.timestamp).toString() };
}

/**
 * The LI.FI rail's EVM reader. Every read is a planned JSON-RPC batch through the command session: one chain identity per
 * endpoint and session, mutable state at the moving head the transaction will execute against, inclusion proofs pinned to
 * block hashes. A transport without batches (a single-request `call`) reads the same planned items one by one.
 */
export class BridgeRpc implements BridgeRpcPort {
  private readonly call: EvmRpcCall;
  private readonly submit: EvmRpcCall;
  private readonly batchCall: BridgeBatchCall;
  private readonly receipts: Readonly<{ reader: boolean; fallback: boolean }>;
  private commandLatestBlock?: BridgeBlock;
  private commandPrices?: Readonly<{ maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }>;
  private commandFeeInputs?: Readonly<{ l1DataFeeUpperWei: bigint; operatorScalar: bigint; operatorConstant: bigint }>;
  private readonly preparedEstimates = new Map<string, string>();
  private readonly readSession: RpcReadSession | undefined;
  constructor(readonly chainId: BridgeChainId, readonly origin: string, call: EvmRpcCall, session?: RpcReadSession, oneAttempt?: EvmRpcCall,
    sessionCall?: (session: RpcReadSession) => EvmRpcCall, sessionBatchCall?: (session: RpcReadSession) => BridgeBatchCall,
    receipts: Readonly<{ reader: boolean; fallback: boolean }> = { reader: false, fallback: false }) {
    bridgeChain(chainId); this.readSession = session; this.receipts = receipts;
    this.call = session === undefined ? call : sessionCall?.(session) ?? session.wrap(origin, chainId, call, oneAttempt ?? call);
    this.submit = session === undefined || oneAttempt === undefined ? call :
      sessionCall?.(session) ?? (async (method, params, beforeSend) => await submitDirect(method, params, (m, p) => oneAttempt(m, p, beforeSend)));
    this.batchCall = session !== undefined && sessionBatchCall !== undefined ? sessionBatchCall(session)
      : async (items) => await Promise.all(items.map(async (item) => item.decoder(await this.call(item.method, item.params))));
  }
  readTelemetry() { return this.readSession?.telemetry() ?? null; }
  async assertChain(): Promise<void> { await this.batchCall([chainItem(this.chainId)]); }
  async block(tag: "latest" | "safe" | string): Promise<BridgeBlock> {
    const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
    const [, raw] = await this.batchCall([chainItem(this.chainId), { method: "eth_getBlockByNumber", params: [rpcTag, false],
      cachePolicy: tag === "latest" || tag === "safe" ? "snapshot" : "immutable", decoder: rpcBlockValue }]);
    const block = blockOf(raw as Record<string, unknown>);
    if (tag !== "latest" && tag !== "safe" && block.numberAtomic !== bridgeUint(tag).toString()) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_number");
    if (tag === "latest") this.commandLatestBlock = block;
    return block;
  }
  /** The light deployment check of one role at the moving head, with that head: one POST. */
  async deploymentCheck(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, role: "source" | "destination") {
    const check = bridgeDeploymentCheck(this.chainId, peerChainId, tool, token, role);
    const [, raw, ...values] = await this.batchCall([chainItem(this.chainId),
      { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: rpcBlockValue }, ...bridgeDeploymentCheckItems(check)]);
    return bridgeDeploymentCheckIdentity(check, values, blockOf(raw as Record<string, unknown>), this.origin);
  }
  /** The source deployment check and the account snapshot in the same POST, at the same moving head. */
  async checkedAccount(check: Readonly<{ tool: BridgeTool; peerChainId: BridgeChainId }>, owner: Address, spender: Address, token: Address,
    planned: readonly BridgeTransaction[] = []) {
    const deployment = bridgeDeploymentCheck(this.chainId, check.peerChainId, check.tool, token, "source");
    const { account, extra } = await this.readAccount(owner, spender, token, planned, bridgeDeploymentCheckItems(deployment));
    return { account, deployment: bridgeDeploymentCheckIdentity(deployment, extra, account.block, this.origin) };
  }
  /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
  async account(owner: Address, spender: Address, token: Address, planned: readonly BridgeTransaction[] = []) {
    return (await this.readAccount(owner, spender, token, planned, [])).account;
  }
  /**
   * One POST at the moving head: approval inclusion and foreground consent can change the account within one invocation,
   * so nothing here is cached and each guard predicate stands on its own answer. Prices, Base fee inputs and the planned
   * estimates are kept for this command so the envelope and fee quotes reuse them instead of reading again.
   */
  private async readAccount(owner: Address, spender: Address, token: Address, planned: readonly BridgeTransaction[], extraItems: readonly PlannedRead[]) {
    const asset = bridgeAssetRow(this.chainId, token, "APN_RPC_CONFIG"), base = this.chainId === 8453, arbitrum = this.chainId === 42161;
    const values = await this.batchCall([chainItem(this.chainId),
      { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: rpcFeeBlockValue },
      ...(arbitrum ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "none" as const, decoder: rpcQuantityValue }]),
      { method: "eth_getBalance", params: [owner, "latest"], cachePolicy: "none", decoder: rpcQuantityValue },
      ...(asset.kind === "native" ? [] : [latestCall(token, encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] })),
        latestCall(token, encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] }))]),
      ...(base ? [latestCall(GAS_ORACLE, L1_UPPER_BOUND), latestCall(L1_BLOCK, "0x4d5d9a2a"), latestCall(L1_BLOCK, "0x16d3bc7f")] : []),
      { method: "eth_getTransactionCount", params: [owner, "latest"], cachePolicy: "none", decoder: rpcQuantityValue },
      { method: "eth_getTransactionCount", params: [owner, "pending"], cachePolicy: "none", decoder: rpcQuantityValue },
      ...planned.map((transaction): PlannedRead => ({ method: "eth_estimateGas", params: [rpcTransactionInput(transaction), "latest"],
        cachePolicy: "none", decoder: rpcQuantityValue })),
      ...extraItems]);
    let offset = 1;
    const raw = values[offset++] as Record<string, unknown>, at = blockOf(raw);
    const priority = arbitrum ? 0n : values[offset++] as bigint, maximum = 2n * evmRpcQuantity(raw.baseFeePerGas) + priority;
    bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
    const native = values[offset++] as bigint, balance = asset.kind === "native" ? native : values[offset++] as bigint;
    const allowance = asset.kind === "native" ? 0n : values[offset++] as bigint;
    const fees = base ? { l1DataFeeUpperWei: values[offset++] as bigint, operatorScalar: values[offset++] as bigint, operatorConstant: values[offset++] as bigint }
      : { l1DataFeeUpperWei: 0n, operatorScalar: 0n, operatorConstant: 0n };
    const latest = values[offset++] as bigint, pending = values[offset++] as bigint;
    const estimates = planned.map(() => values[offset++] as bigint);
    this.commandLatestBlock = at; this.commandFeeInputs = fees;
    this.commandPrices = { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
    planned.forEach((transaction, index) => this.preparedEstimates.set(hashObject(transaction), estimates[index]!.toString()));
    return { extra: values.slice(offset), account: { chainId: this.chainId, rpcOrigin: this.origin, block: at, owner, token, spender,
      balanceAtomic: balance.toString(), nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(),
      latestNonceAtomic: latest.toString(), pendingNonceAtomic: pending.toString() } };
  }
  async prices() {
    if (this.commandPrices !== undefined) return this.commandPrices;
    const values = await this.batchCall([chainItem(this.chainId),
      { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
      ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" as const, decoder: rpcQuantityValue }])]);
    const block = values[1] as Record<string, unknown>, priority = this.chainId === 42161 ? 0n : values[2] as bigint;
    this.commandLatestBlock = blockOf(block);
    const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
    bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
    return this.commandPrices = { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }
  async estimate(transaction: BridgeTransaction) {
    if (transaction.chainId !== this.chainId) bridgeFailure("APN_CHAIN_MISMATCH", "bridge_estimate_chain");
    const prepared = this.preparedEstimates.get(hashObject(transaction));
    if (prepared !== undefined && this.commandPrices !== undefined) return { gasLimitAtomic: prepared, ...this.commandPrices };
    const values = await this.batchCall([chainItem(this.chainId),
      { method: "eth_estimateGas", params: [{ from: transaction.from, to: transaction.to, data: transaction.data,
        value: quantity(bridgeUint(transaction.valueAtomic)) }], cachePolicy: "none", decoder: rpcQuantityValue },
      { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
      ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" as const, decoder: rpcQuantityValue }])]);
    const gas = values[1] as bigint, block = values[2] as Record<string, unknown>, priority = this.chainId === 42161 ? 0n : values[3] as bigint;
    this.commandLatestBlock = blockOf(block);
    const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
    if (maximum === 0n) bridgeFailure("APN_RPC_PROTOCOL", "bridge_zero_gas_price");
    return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }
  async feeQuote(envelope: Pick<BridgeEnvelope, "economics">) { return (await this.feeQuotes([envelope]))[0]!; }
  async feeQuotes(envelopes: readonly Pick<BridgeEnvelope, "economics">[]) {
    if (this.commandLatestBlock !== undefined && this.commandFeeInputs !== undefined) return envelopes.map((envelope) => {
      const execution = bridgeUint(envelope.economics.maximumGasCostAtomic, true), input = this.commandFeeInputs!;
      const operator = BigInt(envelope.economics.gasLimitAtomic) * input.operatorScalar * 100n + input.operatorConstant;
      return bridgeFeeQuote(this.chainId, this.origin, this.commandLatestBlock!, execution, input.l1DataFeeUpperWei, operator);
    });
    const block = this.commandLatestBlock ?? await this.block("latest");
    const values = await this.batchCall([chainItem(this.chainId), ...(this.chainId === 8453 ? envelopes.flatMap((envelope) => [
      latestCall(GAS_ORACLE, L1_UPPER_BOUND),
      latestCall(GAS_ORACLE, encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [bridgeUint(envelope.economics.gasLimitAtomic, true)] })),
    ]) : [])]);
    let offset = 1;
    return envelopes.map((envelope) => {
      const l1 = this.chainId === 8453 ? values[offset++] as bigint : 0n, operator = this.chainId === 8453 ? values[offset++] as bigint : 0n;
      return bridgeFeeQuote(this.chainId, this.origin, block, bridgeUint(envelope.economics.maximumGasCostAtomic, true), l1, operator);
    });
  }
  async send(raw: Hex, beforeSend?: BridgeAuthorityCheck): Promise<Hex> {
    bridgeHex(raw, 16 * 1024, undefined, "APN_PROVIDER_EFFECT_UNAVAILABLE");
    if (beforeSend !== undefined) { assertBridgePhysicalGrant(beforeSend, raw); await beforeSend(); }
    const hash = evmRpcHex(await this.submit("eth_sendRawTransaction", [raw], beforeSend), 32);
    if (hash !== keccak256(raw)) bridgeFailure("APN_RPC_AMBIGUOUS", "submitted_transaction_hash_mismatch");
    return hash;
  }
  async observe(hash: Hex, expected?: BridgeEnvelope, nativeDelivery?: Parameters<BridgeRpcPort["observe"]>[2],
    options?: BridgeObservationOptions): Promise<{ transaction: BridgeTransactionProof; receipt: BridgeProtocolReceipt } | null> {
    return await observeCanonical(this.observation(options), hash, expected, nativeDelivery, true, options) as
      { transaction: BridgeTransactionProof; receipt: BridgeProtocolReceipt } | null;
  }
  async observeDestination(hash: Hex, nativeDelivery?: Parameters<NonNullable<BridgeRpcPort["observeDestination"]>>[1],
    options?: BridgeObservationOptions): Promise<{ transaction: BridgeDestinationTransactionProof; receipt: BridgeProtocolReceipt } | null> {
    return await observeCanonical(this.observation(options), hash, undefined, nativeDelivery, false, options) as
      { transaction: BridgeDestinationTransactionProof; receipt: BridgeProtocolReceipt } | null;
  }
  private observation(options?: BridgeObservationOptions): BridgeObservationContext {
    return { chainId: this.chainId, origin: this.origin, call: this.call, batchCall: this.batchCall, receipts: this.receipts };
  }
}
