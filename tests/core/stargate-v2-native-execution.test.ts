import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, parseAbiParameters,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import {
  executeStargateV2NativeEth, FileStargateNativeJournal, prepareStargateV2NativeEth, stargateV2NativeCanonicalReceipt, type StargateNativeExecutionPorts,
  type StargateNativeJournal, type StargateNativeOperation,
} from "../../src/stargate-v2/native-execution.js";
import { StateStore } from "../../src/state.js";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
const OWNER = privateKeyToAccount(PRIVATE_KEY).address;
const SOURCE = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const DESTINATION = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
const BLOCK = `0x${"ab".repeat(32)}` as Hex;
const DEST_BLOCK = `0x${"cd".repeat(32)}` as Hex;
const GUID = `0x${"ef".repeat(32)}` as Hex;
const AMOUNT = 1_000_000_000_000n;
const FEE = 100n;

class MemoryJournal implements StargateNativeJournal {
  value: StargateNativeOperation | null = null;
  history: StargateNativeOperation[] = [];
  private tail: Promise<void> = Promise.resolve();
  async load(id: string) { return this.value?.operationId === id ? structuredClone(this.value) : null; }
  async save(value: StargateNativeOperation) { this.value = structuredClone(value); this.history.push(structuredClone(value)); }
  async withLock<T>(_id: string, work: () => Promise<T>): Promise<T> {
    const prior = this.tail; let release!: () => void; this.tail = new Promise<void>(resolve => { release = resolve; });
    await prior; try { return await work(); } finally { release(); }
  }
  async withOwnerChainLock<T>(_owner: `0x${string}`, _chainId: number, work: () => Promise<T>): Promise<T> { return await work(); }
}

function quoteRpc(options: { code?: Hex; fee?: bigint; freshFee?: bigint; estimateGas?: bigint } = {}) {
  let quoteRound = 0;
  const methods: string[] = [];
  const call: StargateNativeExecutionPorts["sourceCall"] = async (method, params) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: BLOCK };
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

function destinationRpc(): StargateNativeExecutionPorts["destinationCall"] {
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

function sourceReceipt(hash: Hex, owner = OWNER, received = AMOUNT) {
  const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", args: { guid: GUID, fromAddress: owner } }) as readonly Hex[];
  const data = encodeAbiParameters(parseAbiParameters("uint32 dstEid,uint256 amountSentLD,uint256 amountReceivedLD"), [30320, AMOUNT, received]);
  return { transactionHash: hash, status: "success" as const, blockNumberAtomic: "20", blockHash: BLOCK, finality: "safe" as const,
    logs: [{ address: SOURCE, topics, data }] };
}

function setup(options: { code?: Hex; fee?: bigint; freshFee?: bigint; estimateGas?: bigint; sendError?: boolean; destination?: "event" | "pending" } = {}) {
  const q = quoteRpc(options), journal = new MemoryJournal(); let sends = 0, signs = 0, approvals = 0, envelope: StargateNativeOperation["envelope"] | undefined;
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
    signerIdentity: async () => ({ profile: "owner", address: OWNER }),
    approve: async () => { approvals++; },
    sendRawTransaction: async raw => { sends++; if (options.sendError) throw new Error("timeout"); return keccak256(raw); },
    waitSourceReceipt: async hash => options.sendError ? null : sourceReceipt(hash),
    observeDestination: async input => options.destination === "pending" ? null : ({ mode: "oft_received", emitter: DESTINATION,
      sourceTransactionHash: input.sourceTransactionHash, guid: input.guid, sourceEid: 30101,
      destinationTransactionHash: DEST_BLOCK, logIndexAtomic: "0",
      blockNumberAtomic: "30", blockHash: DEST_BLOCK, finality: "safe", recipient: input.recipient, amountReceivedAtomic: AMOUNT.toString() }),
    now: () => 2_000_000_000_000,
  };
  return { ports, journal, q, counts: () => ({ sends, signs, approvals }), envelope: () => envelope };
}

const request = (changes: Partial<Parameters<typeof prepareStargateV2NativeEth>[0]> = {}) => ({
  profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: AMOUNT.toString(), maxNativeDebitAtomic: "2000000000000",
  idempotencyKey: "stargate-native-001", ...changes,
});

test("prepares only Ethereum native ETH to Unichain self with exact sendToken calldata and total value", async () => {
  const s = setup(), op = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  assert.equal(op.phase, "prepared"); assert.equal(op.sourceEid, 30101); assert.equal(op.destinationEid, 30320);
  assert.deepEqual(op.finalityPolicy, { version: "apn.stargate-v2-finality.v1", source: { chainId: 1, blockTag: "safe" },
    destination: { chainId: 130, blockTag: "safe" } });
  assert.equal(op.envelope.to, SOURCE); assert.equal(op.totalValueAtomic, (AMOUNT + FEE).toString());
  assert.equal(op.maximumDebitAtomic, (AMOUNT + FEE + 200_000n).toString());
  const decoded = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: op.envelope.data });
  assert.equal(decoded.functionName, "sendToken"); assert.equal(decoded.args[0].dstEid, 30320);
  assert.equal(decoded.args[0].amountLD, AMOUNT); assert.equal(decoded.args[0].minAmountLD, AMOUNT);
  assert.equal(decoded.args[1].nativeFee, FEE); assert.equal(decoded.args[2], OWNER);
  assert.equal(op.destinationBalanceBeforeAtomic, "500"); assert.equal(s.counts().sends, 0);
});

test("refuses non-self recipient before quote, signing, or submission", async () => {
  const s = setup(); await assert.rejects(prepareStargateV2NativeEth(request({ recipient: "0x2222222222222222222222222222222222222222" }), s.ports, s.journal),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details.reason === "first_lane_requires_self_recipient");
  assert.deepEqual(s.q.methods, []); assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 0 });
});

test("refuses a maxNativeDebit cap below principal plus message fee plus gas envelope", async () => {
  const s = setup(); await assert.rejects(prepareStargateV2NativeEth(request({ maxNativeDebitAtomic: AMOUNT.toString() }), s.ports, s.journal),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details.reason === "max_native_debit_exceeded");
  assert.equal(s.counts().signs, 0); assert.equal(s.counts().sends, 0);
});

test("refuses native principal dust that quoteOFT would round down", async () => {
  const s = setup(); await assert.rejects(prepareStargateV2NativeEth(request({ amountAtomic: (AMOUNT + 1n).toString() }), s.ports, s.journal),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details.reason === "dust_amount_not_supported");
  assert.equal(s.counts().signs, 0); assert.equal(s.counts().sends, 0);
});

test("foreground approval, attempt marker, exact hash, source event and destination event become canonical observed evidence", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  const observed = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.equal(observed.guid, GUID); assert.equal(observed.sourceReceipt?.finality, "safe");
  assert.equal(observed.destinationEvidence?.mode, "oft_received"); assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
  assert.deepEqual(s.journal.history.map(x => x.phase), ["prepared", "approved", "submission_started", "submitted", "observed"]);
  assert.equal(s.envelope()?.valueAtomic, (AMOUNT + FEE).toString());
  const receipt = stargateV2NativeCanonicalReceipt(observed);
  assert.equal(receipt.schemaVersion, "apn.stargate-v2-native-receipt.v1"); assert.match(receipt.evidenceHash, /^[a-f0-9]{64}$/u);
});

test("ambiguous send is durable unknown_finality and repeated execute observes without signing or resend", async () => {
  const s = setup({ sendError: true }), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  const first = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(first.phase, "unknown_finality"); assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
  const second = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(second.phase, "unknown_finality"); assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
  assert.equal(s.journal.history.filter(x => x.phase === "submission_started").length, 1);
});

test("source code mutation immediately before send refuses before signing", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal); let latest = false;
  const original = s.ports.sourceCall; (s.ports as any).sourceCall = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getCode" && params[1] === "latest") { latest = true; return "0x60026000"; }
    return original(method as never, params);
  };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "source_code_changed");
  assert.equal(latest, true); assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
});

test("mutated fresh fee after approval requires reprepare and never signs", async () => {
  const s = setup({ freshFee: FEE + 1n }), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal), { code: "APN_REPREPARE_REQUIRED" });
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
});

test("destination pending keeps submitted source proof and a later call observes without resending", async () => {
  const s = setup({ destination: "pending" }), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  const pending = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(pending.phase, "submitted"); assert.equal(pending.sourceReceipt?.guid, GUID); assert.equal(s.counts().sends, 1);
  (s.ports as any).observeDestination = async (input: any) => ({ mode: "oft_received", emitter: DESTINATION,
    sourceTransactionHash: input.sourceTransactionHash, guid: input.guid, sourceEid: 30101, blockNumberAtomic: "31",
    destinationTransactionHash: DEST_BLOCK, logIndexAtomic: "0",
    blockHash: DEST_BLOCK, finality: "safe", recipient: input.recipient, amountReceivedAtomic: AMOUNT.toString() });
  const observed = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.equal(s.counts().sends, 1); assert.equal(s.counts().signs, 1);
});

test("mutated OFTSent amount is refused and cannot create destination evidence", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  (s.ports as any).waitSourceReceipt = async (hash: Hex) => sourceReceipt(hash, OWNER, AMOUNT - 1n);
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal), { code: "APN_RPC_PROTOCOL" });
  assert.equal(s.journal.value?.phase, "submitted"); assert.equal(s.journal.value?.destinationEvidence, undefined);
});

test("same idempotency key with mutated principal is a conflict before any new quote", async () => {
  const s = setup(); await prepareStargateV2NativeEth(request(), s.ports, s.journal); const before = s.q.methods.length;
  await assert.rejects(prepareStargateV2NativeEth(request({ amountAtomic: (AMOUNT * 2n).toString() }), s.ports, s.journal),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details.reason === "idempotency_conflict");
  assert.equal(s.q.methods.length, before); assert.equal(s.counts().signs, 0); assert.equal(s.counts().sends, 0);
});

test("two concurrent execute calls serialize to exactly one sign and one send", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  const [a, b] = await Promise.all([
    executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
  ]);
  assert.equal(a.phase, "observed"); assert.equal(b.phase, "observed");
  assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
});

test("signed raw transaction with mutated value is refused before marker and send", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal), account = privateKeyToAccount(PRIVATE_KEY);
  (s.ports as any).signer = { kind: "imported_evm_signer", address: OWNER, signTransaction: async (tx: any) =>
    await account.signTransaction({ type: "eip1559", chainId: 1, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic) + 1n,
      nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] }) };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details.reason === "signed_transaction_value");
  assert.equal(s.journal.value?.phase, "approved"); assert.equal(s.counts().sends, 0);
});

test("signed EIP-1559 transaction whose zero priority fee parses as undefined is accepted", async () => {
  const s = setup();
  (s.ports as any).prepareEnvelope = async () => ({ nonceAtomic: "7", gasLimitAtomic: "100000", maxFeePerGasAtomic: "2",
    maxPriorityFeePerGasAtomic: "0", nativeBalanceAtomic: "9000000000000000" });
  const prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-zero-priority" }), s.ports, s.journal);
  const observed = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
});

test("missing parsed priority fee is refused when the frozen fee is nonzero", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-missing-priority" }), s.ports, s.journal);
  const account = privateKeyToAccount(PRIVATE_KEY);
  (s.ports as any).signer = { kind: "imported_evm_signer", address: OWNER, signTransaction: async (tx: any) =>
    await account.signTransaction({ type: "eip1559", chainId: 1, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic),
      nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic),
      maxPriorityFeePerGas: 0n, accessList: [] }) };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details.reason === "signed_transaction_priority_fee");
  assert.equal(s.journal.value?.phase, "approved"); assert.equal(s.counts().sends, 0);
});

test("nonzero signed priority fee is refused when the frozen fee is zero", async () => {
  const s = setup();
  (s.ports as any).prepareEnvelope = async () => ({ nonceAtomic: "7", gasLimitAtomic: "100000", maxFeePerGasAtomic: "2",
    maxPriorityFeePerGasAtomic: "0", nativeBalanceAtomic: "9000000000000000" });
  const prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-tampered-priority" }), s.ports, s.journal);
  const account = privateKeyToAccount(PRIVATE_KEY);
  (s.ports as any).signer = { kind: "imported_evm_signer", address: OWNER, signTransaction: async (tx: any) =>
    await account.signTransaction({ type: "eip1559", chainId: 1, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic),
      nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic),
      maxPriorityFeePerGas: 1n, accessList: [] }) };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details.reason === "signed_transaction_priority_fee");
  assert.equal(s.journal.value?.phase, "approved"); assert.equal(s.counts().sends, 0);
});

test("EIP-7702 transaction with matching fees and authorization is refused", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-eip7702" }), s.ports, s.journal);
  const account = privateKeyToAccount(PRIVATE_KEY);
  (s.ports as any).signer = { kind: "imported_evm_signer", address: OWNER, signTransaction: async (tx: any) =>
    await account.signTransaction({ type: "eip7702", chainId: 1, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic),
      nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [], authorizationList: [
        await account.signAuthorization({ chainId: 1, contractAddress: SOURCE, nonce: 0 }),
      ] }) };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details.reason === "signed_transaction_type");
  assert.equal(s.journal.value?.phase, "approved"); assert.equal(s.counts().sends, 0);
});

test("balance delta cannot finalize destination delivery", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request(), s.ports, s.journal);
  (s.ports as any).observeDestination = async (input: any) => ({ mode: "balance_delta", blockNumberAtomic: "31", blockHash: DEST_BLOCK,
    finality: "safe", recipient: input.recipient, balanceBeforeAtomic: "500", balanceAfterAtomic: (500n + AMOUNT).toString(), deltaAtomic: AMOUNT.toString() });
  const result = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(result.phase, "submitted"); assert.equal(result.destinationEvidence, undefined); assert.equal(s.counts().sends, 1);
});

test("destination event must bind exact emitter, source eid, guid, source transaction and frozen amount", async () => {
  for (const mutation of ["emitter", "sourceEid", "guid", "sourceTransactionHash", "amountReceivedAtomic"] as const) {
    const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: `native-event-${mutation}` }), s.ports, s.journal);
    const original = s.ports.observeDestination;
    (s.ports as any).observeDestination = async (input: any) => {
      const evidence: any = await original(input);
      if (mutation === "emitter") evidence.emitter = OWNER;
      if (mutation === "sourceEid") evidence.sourceEid = 30102;
      if (mutation === "guid") evidence.guid = DEST_BLOCK;
      if (mutation === "sourceTransactionHash") evidence.sourceTransactionHash = DEST_BLOCK;
      if (mutation === "amountReceivedAtomic") evidence.amountReceivedAtomic = (AMOUNT - 1n).toString();
      return evidence;
    };
    await assert.rejects(() => executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
      (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details.reason === "destination_event");
    assert.equal(s.counts().sends, 1);
  }
});

test("changed signer identity immediately before signing refuses without attempt marker or send", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-signer-mutation" }), s.ports, s.journal);
  (s.ports as any).signerIdentity = async () => ({ profile: "other", address: OWNER });
  await assert.rejects(() => executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "signer_identity_changed");
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
  assert.equal((await s.journal.load(prepared.operationId))?.phase, "approved");
});

test("fresh exact-call gas estimate cannot exceed the frozen gas limit", async () => {
  const s = setup({ estimateGas: 100_001n }), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-gas-growth" }), s.ports, s.journal);
  await assert.rejects(() => executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "source_gas_limit");
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
});

test("production file journal advisory lock permits exactly one concurrent broadcast", async (t) => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-stargate-file-journal-")); t.after(async () => await rm(root, { recursive: true, force: true }));
  const state = new StateStore(root); await state.initialize();
  const journal = new FileStargateNativeJournal(root, state);
  for (let index = 0; index < 8; index++) {
    const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: `native-file-concurrent-${index}` }), s.ports, s.journal);
    await journal.save(prepared);
    const results = await Promise.all([
      executeStargateV2NativeEth(prepared.operationId, s.ports, journal),
      executeStargateV2NativeEth(prepared.operationId, s.ports, journal),
    ]);
    assert.deepEqual(results.map(result => result.phase), ["observed", "observed"]);
    assert.deepEqual(s.counts(), { sends: 1, signs: 1, approvals: 1 });
    assert.equal((await journal.load(prepared.operationId))?.phase, "observed");
  }
});

test("production file journal lock is released by process crash while its stable lock file remains", async (t) => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-stargate-crash-lock-")); t.after(async () => await rm(root, { recursive: true, force: true }));
  const journal = new FileStargateNativeJournal(root), id = "a".repeat(64);
  const moduleUrl = new URL("../../src/stargate-v2/native-execution.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import { FileStargateNativeJournal } from ${JSON.stringify(moduleUrl)};
    const journal = new FileStargateNativeJournal(${JSON.stringify(root)});
    await journal.withLock(${JSON.stringify(id)}, async () => { process.stdout.write("locked\\n"); setInterval(() => {}, 60_000); await new Promise(() => {}); });
  `], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await new Promise<void>((resolve, reject) => { child.stdout!.once("data", () => resolve()); child.once("error", reject);
    child.once("exit", code => reject(new Error(`lock holder exited before ready: ${code}`))); });
  let acquired = false; const contender = journal.withLock(id, async () => { acquired = true; });
  await new Promise<void>(resolve => setTimeout(resolve, 50)); assert.equal(acquired, false);
  child.kill("SIGKILL"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
  await contender; assert.equal(acquired, true);
});

test("production file journal absent-record load is a true local read without directory creation", async (t) => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-stargate-local-read-")); t.after(async () => await rm(root, { recursive: true, force: true }));
  const journal = new FileStargateNativeJournal(root); assert.equal(await journal.load("c".repeat(64)), null);
  await assert.rejects(lstat(join(root, "stargate-v2-native")), (error: any) => error.code === "ENOENT");
});
