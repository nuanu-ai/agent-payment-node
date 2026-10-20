import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, parseAbiParameters,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import { prepareStargateV2NativeEth, type StargateNativeExecutionPorts, type StargateNativeJournal, type StargateNativeOperation } from "../../src/stargate-v2/native-execution.js";

/** Shared fixtures of the direct Stargate V2 native lane: an Ethereum source and Unichain destination in memory. */
export const PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
export const OWNER = privateKeyToAccount(PRIVATE_KEY).address;
export const SOURCE = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
export const DESTINATION = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
export const BLOCK = `0x${"ab".repeat(32)}` as Hex;
export const DEST_BLOCK = `0x${"cd".repeat(32)}` as Hex;
export const GUID = `0x${"ef".repeat(32)}` as Hex;
export const AMOUNT = 1_000_000_000_000n;
export const FEE = 100n;

export function legacyNativeFixture(operation: StargateNativeOperation): StargateNativeOperation {
  const { integrityHash: _integrity, finalityPolicy: _policy, finalityPolicyProvenance: _provenance, policy: _owner, ...current } = operation;
  const body = { ...current, schemaVersion: "apn.stargate-v2-native-operation.v1" as const };
  return { ...body, integrityHash: hashObject(body) } as unknown as StargateNativeOperation;
}
export async function seedNativeFixture(root: string, operation: StargateNativeOperation): Promise<void> {
  const directory = join(root, "stargate-v2-native"); await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${operation.operationId}.json`), `${canonicalJson(operation)}\n`, { mode: 0o600 });
}

export class MemoryJournal implements StargateNativeJournal {
  value: StargateNativeOperation | null = null;
  history: StargateNativeOperation[] = [];
  private tail: Promise<void> = Promise.resolve();
  async load(id: string) { return this.value?.operationId === id ? structuredClone(this.value) : null; }
  async save(value: StargateNativeOperation) { this.value = structuredClone(value); this.history.push(structuredClone(value)); }
  async withLock<T>(_id: string, work: () => Promise<T>): Promise<T> {
    const prior = this.tail; let release!: () => void; this.tail = new Promise<void>(resolve => { release = resolve; });
    await prior; try { return await work(); } finally { release(); }
  }
  async withOwnerLock<T>(_owner: `0x${string}`, work: () => Promise<T>): Promise<T> { return await work(); }
  /** The in-memory journal has no operation index; the file journal's admission is covered by operation-index-families. */
  async admit<T>(_operation: unknown, work: () => Promise<T>): Promise<T> { return await work(); }
}

export function quoteRpc(options: { code?: Hex; fee?: bigint; freshFee?: bigint; estimateGas?: bigint; baseFee?: bigint } = {}) {
  let quoteRound = 0;
  const methods: string[] = [];
  const call: StargateNativeExecutionPorts["sourceCall"] = async (method, params) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: BLOCK, baseFeePerGas: `0x${(options.baseFee ?? 1n).toString(16)}` };
    if (method === "eth_getCode") return options.code ?? "0x60016000";
    if (method === "eth_getBalance") return "0x1fffffffffffff";
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_estimateGas") return `0x${(options.estimateGas ?? 90_000n).toString(16)}`;
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    const data = (params[0] as { data: Hex }).data;
    try {
      const decoded = decodeFunctionData({ abi: STARGATE_QUOTE_ABI, data });
      if (decoded.functionName === "quoteOFT") return encodeAbiParameters(STARGATE_QUOTE_OFT_OUTPUT, [
        { minAmountLD: AMOUNT, maxAmountLD: 100n * AMOUNT }, [], { amountSentLD: AMOUNT, amountReceivedLD: AMOUNT },
      ]);
      quoteRound += 1;
      const fee = quoteRound >= 3 && options.freshFee !== undefined ? options.freshFee : (options.fee ?? FEE);
      return encodeAbiParameters(STARGATE_QUOTE_SEND_OUTPUT, [{ nativeFee: fee, lzTokenFee: 0n }]);
    } catch { /* config getter below */ }
    const decoded = decodeFunctionData({ abi: STARGATE_SEND_ABI, data });
    if (decoded.functionName === "token") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "token", result: "0x0000000000000000000000000000000000000000" });
    if (decoded.functionName === "localEid") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "localEid", result: 30101 });
    if (decoded.functionName === "sharedDecimals") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sharedDecimals", result: 6 });
    if (decoded.functionName === "status") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "status", result: 1 });
    if (decoded.functionName === "stargateType") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "stargateType", result: 0 });
    if (decoded.functionName === "paths") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "paths", result: 1_000_000n });
    if (decoded.functionName === "sendToken") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", result: [
      { guid: GUID, nonce: 1n, fee: { nativeFee: FEE, lzTokenFee: 0n } },
      { amountSentLD: AMOUNT, amountReceivedLD: AMOUNT }, { ticketId: 0n, passengerBytes: "0x" },
    ] });
    throw new Error("unexpected eth_call");
  };
  return { call, methods };
}

export function destinationRpc(): StargateNativeExecutionPorts["destinationCall"] {
  return async (method, params) => {
    if (method === "eth_chainId") return "0x82";
    if (method === "eth_getCode") return "0x60026000";
    if (method !== "eth_call") throw new Error(`unexpected destination ${method}`);
    const decoded = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: (params[0] as { data: Hex }).data });
    if (decoded.functionName === "token") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "token", result: "0x0000000000000000000000000000000000000000" });
    if (decoded.functionName === "localEid") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "localEid", result: 30320 });
    if (decoded.functionName === "sharedDecimals") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sharedDecimals", result: 6 });
    if (decoded.functionName === "status") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "status", result: 1 });
    if (decoded.functionName === "stargateType") return encodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "stargateType", result: 0 });
    throw new Error("unexpected destination eth_call");
  };
}

export function sourceReceipt(hash: Hex, owner = OWNER, received = AMOUNT) {
  const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", args: { guid: GUID, fromAddress: owner } }) as readonly Hex[];
  const data = encodeAbiParameters(parseAbiParameters("uint32 dstEid,uint256 amountSentLD,uint256 amountReceivedLD"), [30320, AMOUNT, received]);
  return { transactionHash: hash, status: "success" as const, blockNumberAtomic: "20", blockHash: BLOCK, finality: "safe" as const,
    logs: [{ address: SOURCE, topics, data }] };
}

export const POLICY = { policyDigest: "a".repeat(64), policyRevision: 1, mechanism: { provider: "stargate-v2",
  reference: `eip155:1:${SOURCE}/eip155:130:${DESTINATION}` } };
export function setup(options: { code?: Hex; fee?: bigint; freshFee?: bigint; estimateGas?: bigint; sendError?: boolean; destination?: "event" | "pending";
  baseFee?: bigint; revert?: boolean; reserveError?: boolean } = {}) {
  const q = quoteRpc(options), journal = new MemoryJournal(); let sends = 0, signs = 0, approvals = 0, envelope: StargateNativeOperation["envelope"] | undefined;
  const usage: string[] = [];
  const account = privateKeyToAccount(PRIVATE_KEY);
  const ports: StargateNativeExecutionPorts = {
    sourceCall: q.call,
    destinationCall: destinationRpc(),
    destinationBalance: async recipient => ({ balanceAtomic: "500", blockNumberAtomic: "9", blockHash: DEST_BLOCK }),
    prepareEnvelope: async tx => ({ nonceAtomic: "7", gasLimitAtomic: "100000", maxFeePerGasAtomic: "2",
      maxPriorityFeePerGasAtomic: "1", nativeBalanceAtomic: "9000000000000000" }),
    signer: { kind: "imported_evm_signer", address: OWNER, signTransaction: async tx => {
      signs++; envelope = tx; return await account.signTransaction({ type: "eip1559", chainId: 1, to: tx.to, data: tx.data,
        value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic),
        maxFeePerGas: BigInt(tx.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] });
    } },
    signerIdentity: async () => { usage.push("identity"); return { profile: "owner", address: OWNER }; },
    approve: async () => { approvals++; },
    admitPolicy: async () => { usage.push("admit"); return POLICY; },
    reserveUsage: async () => { if (options.reserveError) throw new Error("usage cap race"); usage.push("reserve"); },
    followUsage: async (_operation, target) => { usage.push(target); },
    sendRawTransaction: async raw => { sends++; if (options.sendError) throw new Error("timeout"); return keccak256(raw); },
    waitSourceReceipt: async hash => options.sendError ? null : options.revert ? { ...sourceReceipt(hash), status: "reverted" as const, logs: [] } : sourceReceipt(hash),
    observeDestination: async input => options.destination === "pending" ? null : ({ mode: "oft_received", emitter: DESTINATION,
      sourceTransactionHash: input.sourceTransactionHash, guid: input.guid, sourceEid: 30101,
      destinationTransactionHash: DEST_BLOCK, logIndexAtomic: "0",
      blockNumberAtomic: "30", blockHash: DEST_BLOCK, finality: "safe", recipient: input.recipient, amountReceivedAtomic: AMOUNT.toString() }),
    now: () => 2_000_000_000_000,
  };
  return { ports, journal, q, counts: () => ({ sends, signs, approvals }), envelope: () => envelope, usage };
}

export const request = (changes: Partial<Parameters<typeof prepareStargateV2NativeEth>[0]> = {}) => ({
  profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: AMOUNT.toString(), maxNativeDebitAtomic: "2000000000000",
  idempotencyKey: "stargate-native-001", ...changes,
});
