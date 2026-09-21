import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbiParameters, parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ApnCore } from "../../src/core.js";
import { hashObject, sha256 } from "../../src/canonical.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { acrossBridgeAbi, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { LocalBridgeCustody } from "../../src/lifi/custody.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import type { BridgeBlock, BridgeEnvelope, BridgeProviderObservation, BridgeRouteRequest, BridgeTool } from "../../src/lifi/model.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import type { BridgeApprovalPort, BridgeRpcFactory, BridgeRpcPort, LifiProviderPort } from "../../src/lifi/ports.js";
import type { RpcReadSession } from "../../src/lifi/rpc.js";
import { bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { BRIDGE_FEE_RULE_HASH } from "../../src/lifi/rpc-fees.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { addressWord, eventLog, makeDestinationReceipt, makeSourceReceipt } from "./lifi-event-fixtures.js";
import { BNB_COMPOSITE } from "../../src/lifi/bnb-composite.js";
import { activateDirectPolicy, WIDE_CAPS } from "./direct-allowlist-helpers.js";
import { bridgeMechanism } from "../../src/lifi/allowlist.js";

export type LifiJson = Record<string, any>;
export const LIFI_SYNTHETIC_KEY = `0x${"01".repeat(32)}` as Hex;
export const LIFI_SYNTHETIC_SENDER = privateKeyToAccount(LIFI_SYNTHETIC_KEY).address;
export const LIFI_RECIPIENT = getAddress("0x4444444444444444444444444444444444444444");
export const LIFI_DESTINATION_HASH = `0x${"56".repeat(32)}` as Hex;
export class LifiWrapping implements WrappingSecretPort {
  loads = 0; creates = 0; available = true;
  async load() { this.loads++; return this.available ? Buffer.alloc(32, 79) : null; }
  async create(): Promise<Buffer> { this.creates++; throw new Error("wrapping creation forbidden in bridge tests"); }
}
export class LifiApproval implements BridgeApprovalPort {
  calls: Parameters<BridgeApprovalPort["confirm"]>[0][] = [];
  accepted = true;
  async confirm(input: Parameters<BridgeApprovalPort["confirm"]>[0]) { this.calls.push(input); return this.accepted; }
}
export async function lifiSteps(pair: "eth-base" | "base-arb" | "arb-eth" | "eth-linea" | "eth-monad" | "eth-bnb", now: Date): Promise<LifiJson[]> {
  if (pair === "eth-bnb") {
    const capture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", "bnb-composite-fly-20260921.json"), "utf8")) as LifiJson;
    const step = structuredClone(capture.materializationResponse), decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data });
    const args = structuredClone(decoded.args) as unknown as any[], messageType = parseAbiParameters("bytes32,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],address");
    const message = decodeAbiParameters(messageType, args[2].message);
    args[0].receiver = LIFI_SYNTHETIC_SENDER; args[2].refundAddress = addressWord(LIFI_SYNTHETIC_SENDER);
    args[2].message = encodeAbiParameters(messageType, [message[0], message[1], LIFI_SYNTHETIC_SENDER]);
    args[2].quoteTimestamp = Math.floor(now.getTime() / 1000) - 10; args[2].fillDeadline = Math.floor(now.getTime() / 1000) + 300;
    step.action.fromAddress = LIFI_SYNTHETIC_SENDER; step.action.toAddress = LIFI_SYNTHETIC_SENDER;
    step.transactionRequest.from = LIFI_SYNTHETIC_SENDER;
    step.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
    return [step];
  }
  if (pair === "eth-linea" || pair === "eth-monad") {
    const capture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", "lifi-ethereum-linea-native-across-20260920.json"), "utf8")) as LifiJson;
    const step = structuredClone(capture.stepResponse);
    if (pair === "eth-linea") return [step];
    const output = "21000000000000000000", minimum = "20900000000000000000";
    const mon = { ...step.action.toToken, chainId: 143, symbol: "MON", name: "MON", coinKey: "MON", priceUSD: "0" };
    step.id = "synthetic-ethereum-monad-native-across";
    step.action.toChainId = 143; step.action.toToken = mon;
    step.estimate.toAmount = output; step.estimate.toAmountMin = minimum; step.estimate.toAmountUSD = "0";
    const cross = step.includedSteps[1];
    cross.action.toChainId = 143; cross.action.toToken = structuredClone(mon);
    cross.estimate.toAmount = output; cross.estimate.toAmountMin = minimum;
    const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: step.transactionRequest.data });
    const args = structuredClone(decoded.args) as unknown as any[];
    args[0].destinationChainId = 143n;
    args[2].receivingAssetId = addressWord(getAddress("0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A"));
    args[2].outputAmount = BigInt(minimum);
    args[2].outputAmountMultiplier = (BigInt(minimum) * 1_000_000_000_000_000_000n + args[0].minAmount - 1n) / args[0].minAmount;
    args[2].quoteTimestamp = Math.floor(now.getTime() / 1000) - 10;
    args[2].fillDeadline = Math.floor(now.getTime() / 1000) + 3600;
    step.transactionRequest.data = encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never });
    return [step];
  }
  const steps: LifiJson[] = [];
  for (const filename of ["lifi-across-step-transactions-20260908.json", "lifi-stargate-taxi-step-transactions-20260908.json"]) {
    const row = (JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", filename), "utf8")) as LifiJson).rows[pair];
    const step: LifiJson = structuredClone(row.step);
    const abi = step.tool === "across" ? acrossBridgeAbi : stargateBridgeAbi;
    const decoded = decodeFunctionData({ abi, data: step.transactionRequest.data }), args = structuredClone(decoded.args) as unknown as any[];
    step.action.fromAddress = LIFI_SYNTHETIC_SENDER; step.action.toAddress = LIFI_RECIPIENT;
    step.includedSteps[1].action.toAddress = LIFI_RECIPIENT;
    step.transactionRequest.from = LIFI_SYNTHETIC_SENDER; args[0].receiver = LIFI_RECIPIENT;
    if (step.tool === "across") {
      args[2].receiverAddress = addressWord(LIFI_RECIPIENT); args[2].refundAddress = addressWord(LIFI_SYNTHETIC_SENDER);
      args[2].quoteTimestamp = Math.floor(now.getTime() / 1000) - 10; args[2].fillDeadline = Math.floor(now.getTime() / 1000) + 3600;
    } else { args[2].sendParams.to = addressWord(LIFI_RECIPIENT); args[2].refundAddress = LIFI_SYNTHETIC_SENDER; }
    step.transactionRequest.data = encodeFunctionData({ abi, functionName: decoded.functionName, args: args as never });
    steps.push(step);
  }
  return steps;
}
export function lifiRoute(step: LifiJson): LifiJson {
  const discovery = structuredClone(step); delete discovery.transactionRequest; delete discovery.transactionId;
  return { id: `route-${step.tool}`, ...step.action, containsSwitchChain: false, toAmount: step.estimate.toAmount,
    toAmountMin: step.estimate.toAmountMin, steps: [discovery] };
}
export class LifiTestProvider implements LifiProviderPort {
  routeCalls = 0; materializeCalls = 0; statusCalls = 0; inventoryCalls = 0;
  statusValue: BridgeProviderObservation["status"] = "pending";
  hint: Hex | null = LIFI_DESTINATION_HASH;
  mutateMaterialization: ((step: LifiJson) => void) | undefined;
  constructor(readonly steps: LifiJson[], readonly now: Date, readonly capturedRoutes?: LifiJson) {}
  async inventory() { this.inventoryCalls++; return { chains: { status: 200, body: '{"chains":[]}' }, tokens: { status: 200, body: '{"tokens":{}}' },
    tools: { status: 200, body: '{"bridges":[]}' }, connections: { status: 200, body: '{"connections":[]}' } }; }
  async routes(_request: BridgeRouteRequest, _sender: Address) { this.routeCalls++; return { status: 200,
    body: JSON.stringify(this.capturedRoutes ?? { routes: this.steps.map(lifiRoute) }) }; }
  async materialize(selected: Readonly<Record<string, unknown>>) {
    this.materializeCalls++; const step = structuredClone(this.steps.find((s) => s.id === selected.id)!);
    this.mutateMaterialization?.(step); return { status: 200, body: JSON.stringify(step) };
  }
  async status() { this.statusCalls++; return { status: this.statusValue, destinationTransactionHash: this.hint,
    observedAt: this.now.toISOString(), responseHash: hashObject({ status: this.statusValue, hint: this.hint }) }; }
}
export class LifiTestRpc implements BridgeRpcPort {
  readonly origin: string;
  readonly blockTimestamp: string;
  calls: string[] = []; submissions: Hex[] = [];
  op: BridgeOperationRecord | undefined;
  allowance = "0"; nonce = 7n; pendingNonce: bigint | undefined;
  native = 1_000_000_000_000_000_000n; balance = 100_000_000n;
  safeApproval = true; safeBridge = true; destinationAvailable = true; destinationSafe = true;
  destinationFillType: 0 | 1 | 2 = 0;
  destinationCompositeOutcome: "completed_native" | "recovered_weth" | "below_floor" | "protocol_mismatch" = "completed_native";
  missingHashes = new Set<Hex>(); reverted = new Set<"approval" | "bridge">();
  sendTimeout = false; returnedHash: Hex | undefined; estimateGas = "300000"; gasPrice = "2000000000";
  drift = false; failObserve = false; failAccount = false; changedBlock = false; scanStart: string | undefined;
  scanned: Parameters<BridgeRpcPort["logs"]>[0][] = []; scanRows: Awaited<ReturnType<BridgeRpcPort["logs"]>> = [];
  constructor(readonly chainId: BridgeChainId, readonly now: Date) { this.origin = `https://rpc-${chainId}.example`; this.blockTimestamp = Math.floor(now.getTime() / 1000).toString(); }
  async assertChain() { this.calls.push("chain"); }
  async block(tag: string): Promise<BridgeBlock> {
    this.calls.push(`block:${tag}`);
    const number = tag === "safe" || tag === "latest" ? "2000" : tag;
    return { numberAtomic: number, hash: `0x${sha256(`${this.chainId}:${number}:${this.changedBlock}`)}`,
      timestampAtomic: this.blockTimestamp };
  }
  async deployment(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, block?: BridgeBlock) {
    this.calls.push("deployment"); const contract = bridgeDeployment(this.chainId, peerChainId, tool, token);
    return { chainId: this.chainId, peerChainId, tool, block: block ?? await this.block("safe"), rpcOrigin: this.origin,
      contractHash: hashObject(contract), codeHash: this.drift ? "0".repeat(64) : hashObject(contract.code), configurationHash: hashObject(contract.reads) };
  }
  async account(owner: Address, spender: Address, token: Address) {
    this.calls.push("account"); if (this.failAccount) throw new Error("synthetic RPC unavailable");
    return { chainId: this.chainId, rpcOrigin: this.origin, block: await this.block("latest"), owner, token, spender,
      balanceAtomic: (token === BRIDGE_ZERO_ADDRESS ? this.native : this.balance).toString(), nativeBalanceWei: this.native.toString(), allowanceAtomic: this.allowance,
      latestNonceAtomic: this.nonce.toString(), pendingNonceAtomic: (this.pendingNonce ?? this.nonce).toString() };
  }
  async prices() { this.calls.push("prices"); return { maxFeePerGasAtomic: this.gasPrice, maxPriorityFeePerGasAtomic: this.chainId === 42161 ? "0" : "1000000000" }; }
  async estimate(transaction: Parameters<BridgeRpcPort["estimate"]>[0]) {
    this.calls.push(transaction.to === BRIDGE_DIAMOND ? "estimate:bridge" : "estimate:approval");
    if (transaction.to === BRIDGE_DIAMOND && transaction.valueAtomic === "0" && this.allowance === "0") throw new Error("must not simulate bridge before allowance exists");
    return { gasLimitAtomic: transaction.to === BRIDGE_DIAMOND ? this.estimateGas : "65000", ...await this.prices() };
  }
  async feeQuote(envelope: Pick<BridgeEnvelope, "economics">) {
    this.calls.push("feeQuote"); const block = await this.block("latest"), l1 = this.chainId === 8453 ? 1000n : 0n, operator = this.chainId === 8453 ? 100n : 0n;
    return { chainId: this.chainId, ...(this.chainId === 42161 ? { feeModel: "arbitrum-inclusive" as const } : {}),
      l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString(), maximumExecutionFeeWei: envelope.economics.maximumGasCostAtomic,
      totalQuoteWei: (BigInt(envelope.economics.maximumGasCostAtomic) + l1 + operator).toString(), totalFeeEnforcedOnchain: false as const,
      blockNumberAtomic: block.numberAtomic, blockHash: block.hash, rpcOrigin: this.origin, observedAt: this.now.toISOString() };
  }
  async send(raw: Hex) {
    this.calls.push("send"); this.submissions.push(raw); const tx = parseTransaction(raw);
    const approval = getAddress(tx.to!) !== BRIDGE_DIAMOND, role = approval ? "approval" : "bridge";
    this.nonce = BigInt(tx.nonce!) + 1n;
    if (!this.reverted.has(role)) this.allowance = approval ? this.op!.intent.materialization.request.amountAtomic : "0";
    if (this.sendTimeout) throw new Error("synthetic timeout after acceptance");
    return this.returnedHash ?? keccak256(raw);
  }
  async observe(hash: Hex, expected?: BridgeEnvelope, _nativeDelivery?: Parameters<BridgeRpcPort["observe"]>[2]) {
    this.calls.push("observe"); if (this.failObserve) throw new Error("synthetic observation unavailable");
    if (this.missingHashes.has(hash) || this.op === undefined) return null;
    const op = this.op, d = op.intent.decoded;
    if (expected === undefined) {
      if (!this.destinationAvailable || hash !== LIFI_DESTINATION_HASH) return null;
      const sourceReceipt = makeSourceReceipt(d), source = bridgeSourceProof(op.intent.materialization, d, sourceReceipt),
        generated = makeDestinationReceipt(d, source, this.destinationFillType), destinationBlock = await this.block("2000");
      let shaped = generated;
      if (d.composite !== undefined && this.destinationCompositeOutcome !== "completed_native") {
        const outcome = this.destinationCompositeOutcome, amount = outcome === "below_floor" ? (BigInt(d.minimumOutputAtomic) - 1n).toString() : "0";
        shaped = { ...generated,
          logs: outcome === "recovered_weth" ? [...generated.logs, eventLog(BNB_COMPOSITE.weth, "Transfer", {
            from: BNB_COMPOSITE.receiver, to: d.recipient, value: BigInt(d.composite.inputAmountAtomic),
          })] : generated.logs,
          nativeBalance: { ...generated.nativeBalance!, afterBalanceAtomic: (100n + BigInt(amount)).toString(), deltaAtomic: amount },
          compositeTrace: { ...generated.compositeTrace!, outcome, deliveredAmountAtomic: amount,
            vaultOutputAtomic: outcome === "below_floor" ? amount : null, retainedAmountAtomic: "0" } };
      }
      const receipt = { ...shaped, transactionHash: hash, blockNumberAtomic: "2000", blockHash: destinationBlock.hash,
          ...(generated.nativeTransfer === undefined || generated.nativeTransfer === null ? {} : { nativeTransfer: {
            ...generated.nativeTransfer, transactionHash: hash,
          } }),
          ...(generated.nativeBalance === undefined || generated.nativeBalance === null ? {} : { nativeBalance: {
            ...shaped.nativeBalance!, beforeBlock: { ...shaped.nativeBalance!.beforeBlock, numberAtomic: "1999" }, afterBlock: destinationBlock,
          } }),
          ...(shaped.compositeTrace === undefined || shaped.compositeTrace === null ? {} : { compositeTrace: { ...shaped.compositeTrace, transactionHash: hash } }) };
      const tx = await this.proof(hash, op.effects.at(-1)!.envelope, this.destinationSafe, receipt.logs, "success", true);
      return { transaction: tx, receipt };
    }
    if (!this.submissions.some((raw) => keccak256(raw) === hash)) return null;
    const role = expected.role, reverted = this.reverted.has(role), safe = role === "approval" ? this.safeApproval : this.safeBridge;
    const base = makeSourceReceipt(d);
    const logs = reverted ? [] : role === "bridge" ? base.logs : [{ address: d.sourceToken,
      topics: [keccak256(Buffer.from("Approval(address,address,uint256)")), addressWord(d.sender), addressWord(BRIDGE_DIAMOND)],
      data: `0x${BigInt(d.sourceAmountAtomic).toString(16).padStart(64, "0")}` as Hex }];
    const transaction = await this.proof(hash, expected, safe, logs, reverted ? "reverted" : "success");
    return { transaction, receipt: { chainId: this.chainId, transactionHash: hash, blockNumberAtomic: transaction.block.numberAtomic,
      blockHash: transaction.block.hash, logs } };
  }
  async logs(input: Parameters<BridgeRpcPort["logs"]>[0]) { this.calls.push("logs"); this.scanned.push(input); return this.scanRows; }
  private async proof(hash: Hex, e: BridgeEnvelope, safe: boolean, logs: readonly unknown[], status: "success" | "reverted", destination = false) {
    const block = await this.block("2000"), gasUsedAtomic = "21000", price = e.economics.maxFeePerGasAtomic,
      execution = BigInt(gasUsedAtomic) * BigInt(price), l1 = this.chainId === 8453 ? 500n : 0n, operator = this.chainId === 8453 ? 50n : 0n;
    return { chainId: this.chainId, transactionHash: hash, block, safeBlock: safe ? block : null, rpcOrigin: this.origin,
      from: destination ? LIFI_RECIPIENT : e.from, to: e.to, nonceAtomic: e.economics.nonceAtomic, valueAtomic: e.valueAtomic,
      dataHash: sha256(Buffer.from(e.data.slice(2), "hex")), gasLimitAtomic: e.economics.gasLimitAtomic,
      maxFeePerGasAtomic: price, maxPriorityFeePerGasAtomic: e.economics.maxPriorityFeePerGasAtomic,
      gasUsedAtomic, effectiveGasPriceAtomic: price, executionFeeWei: execution.toString(), l1DataFeeWei: l1.toString(), operatorFeeWei: operator.toString(),
      blobFeeWei: "0", actualTotalFeeWei: (execution + l1 + operator).toString(), status, logsHash: hashObject(logs),
      feeEvidence: { receiptHash: hashObject({ hash, logs }), ruleHash: BRIDGE_FEE_RULE_HASH,
        arbitrumPosterGasAtomic: this.chainId === 42161 ? "100" : null,
        baseOracle: this.chainId === 8453 ? { oracle: getAddress("0x420000000000000000000000000000000000000F"), from: getAddress(`0x${"0".repeat(40)}`),
          callData: `0x275aedd2${BigInt(gasUsedAtomic).toString(16).padStart(64, "0")}` as Hex, rawReturn: `0x${operator.toString(16).padStart(64, "0")}` as Hex,
          blockHash: block.hash, requireCanonical: true as const, version: "1.6.0" as const, regime: "jovian" as const, scalarAtomic: "0", constantWei: operator.toString() } : null } };
  }
}
export async function lifiFixture(root: string, pair: "eth-base" | "base-arb" | "arb-eth" | "eth-linea" | "eth-monad" | "eth-bnb" = "eth-base", options: {
  now?: Date; wrapping?: LifiWrapping; provider?: LifiTestProvider; source?: LifiTestRpc; destination?: LifiTestRpc; initializeWallet?: boolean;
  rpcFor?: BridgeRpcFactory;
  maxNativeDebitWei?: string;
  policy?: false | { readonly maximumPerTransferAtomic?: string; readonly dailyLimitAtomic?: string;
    readonly provider?: string; readonly reference?: string };
} = {}) {
  const now = options.now ?? new Date(pair === "eth-bnb" ? "2026-09-20T16:23:00.000Z" : pair === "eth-linea" || pair === "eth-monad" ? "2026-09-20T10:54:00.000Z" : "2026-09-08T12:00:00.000Z"), state = new StateStore(root), profile = "lifi-local";
  const wrapping = options.wrapping ?? new LifiWrapping(), wallets = new EncryptedWalletStore(state, wrapping);
  await state.initialize();
  if (options.initializeWallet !== false) {
    const identity = { profile, address: LIFI_SYNTHETIC_SENDER, chainId: 8453 as const, createdAt: now.toISOString(), bindingHash: hashObject({ profile, address: LIFI_SYNTHETIC_SENDER, createdAt: now.toISOString() }) };
    await wallets.save(identity, { version: "apn.wallet-secret.v1", privateKey: LIFI_SYNTHETIC_KEY, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 79));
    await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile, profileHash: state.profileHash(profile),
      address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash }));
  }
  let capturedRoutes: LifiJson | undefined;
  if ((pair === "eth-linea" || pair === "eth-bnb") && options.provider === undefined) {
    const capture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", pair === "eth-bnb" ? "bnb-composite-fly-20260921.json" : "lifi-ethereum-linea-native-across-20260920.json"), "utf8")) as LifiJson;
    capturedRoutes = structuredClone(capture.routeResponse);
    if (pair === "eth-bnb") {
      const route = capturedRoutes!.routes[0]; route.fromAddress = LIFI_SYNTHETIC_SENDER; route.toAddress = LIFI_SYNTHETIC_SENDER;
      for (const step of route.steps) { step.action.fromAddress = LIFI_SYNTHETIC_SENDER; step.action.toAddress = LIFI_SYNTHETIC_SENDER; }
    }
  }
  const provider = options.provider ?? new LifiTestProvider(await lifiSteps(pair, now), now, capturedRoutes), a = provider.steps[0]!.action;
  const activatePolicy = async (tool: BridgeTool) => {
    if (options.initializeWallet === false || options.policy === false) return;
    const caps = { maximumPerTransferAtomic: options.policy?.maximumPerTransferAtomic ?? WIDE_CAPS.maximumPerTransferAtomic,
      dailyLimitAtomic: options.policy?.dailyLimitAtomic ?? WIDE_CAPS.dailyLimitAtomic };
    const mechanism = bridgeMechanism(tool);
    await activateDirectPolicy(root, profile, { accounts: { evm: LIFI_SYNTHETIC_SENDER }, now, admissions: [{
      chain: `eip155:${a.fromChainId}`, ...(a.fromToken.address === BRIDGE_ZERO_ADDRESS ? { kind: "native" as const }
        : { kind: "token" as const, identifier: a.fromToken.address }), rail: "bridge", ...caps,
      mechanism: { provider: options.policy?.provider ?? mechanism.provider,
        reference: options.policy?.reference ?? mechanism.reference },
    }] });
  };
  await activatePolicy("across");
  const source = options.source ?? new LifiTestRpc(a.fromChainId, now), destination = options.destination ?? new LifiTestRpc(a.toChainId, now);
  const approval = new LifiApproval(), custody = new LocalBridgeCustody(state, wrapping, () => now.getTime()), rpcSessions: RpcReadSession[] = [];
  const fakeRpcFor = (chain: BridgeChainId, session?: RpcReadSession) => {
    assert.ok(chain === source.chainId || chain === destination.chainId);
    if (session !== undefined) rpcSessions.push(session);
    return chain === source.chainId ? source : destination;
  };
  const dependencies = { provider, rpcFor: options.rpcFor ?? fakeRpcFor, custody, approval };
  const core = new ApnCore({ state, bridge: dependencies, clock: { now: () => new Date(now) } });
  const native = a.fromToken.address === BRIDGE_ZERO_ADDRESS;
  const request: BridgeRouteRequest = { fromChainId: a.fromChainId, toChainId: a.toChainId, fromToken: a.fromToken.address, toToken: a.toToken.address,
    recipient: pair === "eth-linea" || pair === "eth-monad" || pair === "eth-bnb" ? LIFI_SYNTHETIC_SENDER : LIFI_RECIPIENT, amountAtomic: a.fromAmount, minOutputAtomic: native ? provider.steps[0]!.estimate.toAmountMin : "9000000",
    maxNativeDebitWei: options.maxNativeDebitWei ?? (native ? "2000000000000000" : "20000000000000000"), maxRouteFeeAtomic: native ? "100000000000000" : "1000000", slippageBps: 50 };
  const prepare = async (tool: BridgeTool = "across", key = "lifi-fixture-0001") => {
    if (tool !== "across" && options.policy === undefined) await activatePolicy(tool);
    const quotes = await core.execute({ command: "bridge.routes", profile, request }); assert.equal(quotes.ok, true, quotes.error?.message);
    const quote = (quotes.data as { quote_hash: string }).quote_hash;
    const routeId = provider.capturedRoutes?.routes.find((route: LifiJson) => route.steps?.[0]?.tool === tool)?.id ?? `route-${tool}`;
    const input = { command: "bridge.prepare", profile, quote, route: routeId, idempotencyKey: key } as const;
    const prepared = await core.execute(input); assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
    const id = (prepared.operation as { operation_id: string }).operation_id;
    source.op = (await core.bridges.records.findOperation(id))!; destination.op = source.op;
    return { id, input, quote, operation: source.op };
  };
  return { core, state, now, wrapping, wallets, provider, source, destination, approval, custody, dependencies, rpcSessions, profile, request, prepare };
}
