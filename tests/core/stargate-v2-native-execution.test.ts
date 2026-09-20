import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, parseAbiParameters,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import {
  executeStargateV2NativeEth, prepareStargateV2NativeEth, stargateV2NativeCanonicalReceipt, type StargateNativeExecutionPorts,
  type StargateNativeJournal, type StargateNativeOperation,
} from "../../src/stargate-v2/native-execution.js";

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
  async load(id: string) { return this.value?.operationId === id ? structuredClone(this.value) : null; }
  async save(value: StargateNativeOperation) { this.value = structuredClone(value); this.history.push(structuredClone(value)); }
}

function quoteRpc(options: { code?: Hex; fee?: bigint; freshFee?: bigint } = {}) {
  let quoteRound = 0;
  const methods: string[] = [];
  const call: StargateNativeExecutionPorts["sourceCall"] = async (method, params) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: BLOCK };
    if (method === "eth_getCode") return options.code ?? "0x60016000";
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
    throw new Error("unexpected eth_call");
  };
  return { call, methods };
}

function sourceReceipt(hash: Hex, owner = OWNER, received = AMOUNT) {
  const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", args: { guid: GUID, fromAddress: owner } }) as readonly Hex[];
  const data = encodeAbiParameters(parseAbiParameters("uint32 dstEid,uint256 amountSentLD,uint256 amountReceivedLD"), [30320, AMOUNT, received]);
  return { transactionHash: hash, status: "success" as const, blockNumberAtomic: "20", blockHash: BLOCK, finality: "safe" as const,
    logs: [{ address: SOURCE, topics, data }] };
}

function setup(options: { code?: Hex; fee?: bigint; freshFee?: bigint; sendError?: boolean; destination?: "event" | "pending" } = {}) {
  const q = quoteRpc(options), journal = new MemoryJournal(); let sends = 0, signs = 0, approvals = 0, envelope: StargateNativeOperation["envelope"] | undefined;
  const account = privateKeyToAccount(PRIVATE_KEY);
  const ports: StargateNativeExecutionPorts = {
    sourceCall: q.call,
    destinationBalance: async recipient => ({ balanceAtomic: "500", blockNumberAtomic: "9", blockHash: DEST_BLOCK }),
    prepareEnvelope: async tx => ({ nonceAtomic: "7", gasLimitAtomic: "100000", maxFeePerGasAtomic: "2",
      maxPriorityFeePerGasAtomic: "1", nativeBalanceAtomic: "9000000000000000" }),
    signer: { kind: "imported_evm_signer", address: OWNER, signTransaction: async tx => {
      signs++; envelope = tx; return await account.signTransaction({ type: "eip1559", chainId: 1, to: tx.to, data: tx.data,
        value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic),
        maxFeePerGas: BigInt(tx.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] });
    } },
    approve: async () => { approvals++; },
    sendRawTransaction: async raw => { sends++; if (options.sendError) throw new Error("timeout"); return keccak256(raw); },
    waitSourceReceipt: async hash => options.sendError ? null : sourceReceipt(hash),
    observeDestination: async input => options.destination === "pending" ? null : ({ mode: "oft_received", guid: input.guid,
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
  (s.ports as any).observeDestination = async (input: any) => ({ mode: "oft_received", guid: input.guid, blockNumberAtomic: "31",
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
