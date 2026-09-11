import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, keccak256, parseTransaction,
  type Abi, type AbiParameter, type TransactionSerializable } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "../../../src/canonical.js";
import type { Address, Hex } from "../../../src/model.js";
import { GASLESS_ENTRYPOINT_ABI, GASLESS_PAYMASTER_ABI, GASLESS_TOKEN_ABI } from "../../../src/gasless/abi.js";
import type { GaslessTransport } from "../../../src/gasless/https.js";
import type { GaslessBlock, GaslessIntent, GaslessLog } from "../../../src/gasless/model.js";
import { gaslessDeployment } from "../../../src/gasless/registry.js";

type Json = Record<string, any>;
export type ObservationFault = "" | "chain" | "initial_hash" | "initial_timestamp" | "post_initial_reorg" |
  "protocol_code" | "protocol_storage" | "protocol_domain" | "permit" | "allowance" | "pending" |
  "entrypoint" | "eoa" | "owner_code" | "finality" | "current_reorg" | "cursor_reorg" |
  "scan_error" | "log_malformed" | "log_truncated" | "log_wrong_identity" |
  "receipt_missing" | "receipt_conflict" | "receipt_malformed";

export interface ObservationCall {
  readonly endpoint: string;
  readonly method: string;
  readonly params: readonly unknown[];
  readonly id: string;
  readonly maxBytes: number;
  readonly code: string;
}

const OUTER = privateKeyToAccount(`0x${"2".repeat(64)}` as Hex);
const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
const quantity = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}`;

/** Production-shape observation transport backed only by captured protocol data and synthetic chain state. */
export class ObservationTransport implements GaslessTransport {
  readonly calls: ObservationCall[] = [];
  fault: ObservationFault = "";
  safeNumber: bigint;
  invalidationAt: bigint;
  finalIdentity = false;
  private finalHash: Hex | undefined;
  private initialReads = 0;
  private readonly blockNumbers = new Map<string, bigint>();
  private settlement: { userOperationHash: Hex; transactionHash: Hex; transaction: Json; receipt: Json;
    included: GaslessBlock } | undefined;

  private constructor(readonly endpoint: string, readonly intent: GaslessIntent,
    private readonly codes: ReadonlyMap<string, Hex>) {
    const start = BigInt(intent.initialSnapshot.block.numberAtomic);
    this.safeNumber = start + 2n;
    this.invalidationAt = start;
    this.blockNumbers.set(intent.initialSnapshot.block.hash, start);
  }

  static async create(endpoint: string, intent: GaslessIntent): Promise<ObservationTransport> {
    const captured = JSON.parse(await readFile(resolve("tests/core/gasless-fixtures/deployment-base.json"), "utf8")) as Json;
    const additional = JSON.parse(await readFile(resolve("tests/core/gasless-fixtures/bundler-runtime-code.json"), "utf8")) as Json;
    const runtimes = [captured.token.proxyRuntime, captured.token.implementationRuntime,
      captured.token.signatureCheckerRuntime, captured.entryPointRuntime, captured.delegateRuntime,
      captured.paymasterProxyRuntime, captured.paymasterImplementationRuntime] as Json[];
    const codes = new Map<string, Hex>();
    for (const runtime of runtimes) if (runtime.raw !== undefined) codes.set(String(runtime.address).toLowerCase(), runtime.raw as Hex);
    for (const runtime of additional.codes as Json[]) codes.set(String(runtime.address).toLowerCase(), runtime.code as Hex);
    for (const row of gaslessDeployment(8453).code) assert.ok(codes.has(row.address.toLowerCase()), `missing runtime ${row.address}`);
    return new ObservationTransport(endpoint, intent, codes);
  }

  setFault(fault: ObservationFault): void { this.fault = fault; }
  setFinalIdentity(userOperationHash?: Hex): void { this.finalIdentity = true; this.finalHash = userOperationHash; }
  setScan(safeNumber: bigint, invalidationAt: bigint): void {
    this.safeNumber = safeNumber;
    this.invalidationAt = invalidationAt;
  }

  async installSettlement(userOperationHash: Hex): Promise<void> {
    this.setFinalIdentity(userOperationHash);
    const start = BigInt(this.intent.initialSnapshot.block.numberAtomic), included = this.block(start + 1n);
    const common = { chainId: 8453, to: this.intent.entryPoint, nonce: 7, gas: 400_000n,
      value: 0n, data: "0x12345678" as Hex, maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 0n, type: "eip1559", accessList: [] } satisfies TransactionSerializable;
    const raw = await OUTER.signTransaction(common), parsed = parseTransaction(raw) as Json;
    const transactionHash = keccak256(raw);
    const transaction = { hash: transactionHash, chainId: "0x2105", type: "0x2", nonce: "0x7",
      from: OUTER.address, to: common.to, gas: quantity(common.gas), value: "0x0", input: common.data,
      r: quantity(BigInt(parsed.r)), s: quantity(BigInt(parsed.s)), v: quantity(parsed.v ?? BigInt(parsed.yParity)),
      yParity: quantity(parsed.yParity), accessList: parsed.accessList ?? [],
      maxFeePerGas: quantity(common.maxFeePerGas), maxPriorityFeePerGas: "0x0",
      blockNumber: quantity(BigInt(included.numberAtomic)), blockHash: included.hash, transactionIndex: "0x0" };
    const logs = settlementLogs(this.intent, userOperationHash).map(log => rawLog(log, transactionHash, included));
    const receipt = { transactionHash, blockNumber: transaction.blockNumber, blockHash: included.hash,
      transactionIndex: "0x0", type: "0x2", from: OUTER.address, to: this.intent.entryPoint,
      status: "0x1", logs };
    this.settlement = { userOperationHash, transactionHash, transaction, receipt, included };
    this.safeNumber = start + 2n;
  }

  async request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG") {
    assert.equal(endpoint, this.endpoint);
    assert.equal(method, "POST");
    assert.notEqual(body, null);
    const request = JSON.parse(body!) as Json;
    assert.deepEqual(Object.keys(request), ["id", "jsonrpc", "method", "params"]);
    this.calls.push({ endpoint, method: request.method, params: request.params, id: request.id, maxBytes, code });
    const result = await this.response(request.method, request.params as readonly unknown[]);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  }

  private async response(method: string, params: readonly unknown[]): Promise<unknown> {
    const deployment = gaslessDeployment(8453), initial = this.intent.initialSnapshot;
    if (method === "eth_chainId") return this.fault === "chain" ? "0x1" : "0x2105";
    if (method === "eth_getBlockByNumber") {
      const tag = params[0] as string;
      if (tag === "safe" && this.fault === "finality") throw new Error("canary_finality_secret");
      const number = tag === "safe" ? this.safeNumber : tag === "latest" ? this.safeNumber + 1n : BigInt(tag);
      if (number === BigInt(initial.block.numberAtomic)) {
        this.initialReads += 1;
        if (this.fault === "initial_hash" || (this.fault === "post_initial_reorg" && this.initialReads >= 4)) {
          return this.rawBlock(number, word(9001n), BigInt(initial.block.timestampAtomic));
        }
        if (this.fault === "initial_timestamp") return this.rawBlock(number, initial.block.hash,
          BigInt(initial.block.timestampAtomic) + 1n);
      }
      if (this.fault === "cursor_reorg" && number !== BigInt(initial.block.numberAtomic) && number !== this.safeNumber) {
        return this.rawBlock(number, word(9002n));
      }
      if (this.fault === "current_reorg" && tag.startsWith("0x") && number === this.safeNumber) {
        return this.rawBlock(number, word(9003n));
      }
      return this.rawBlock(number, this.block(number).hash);
    }
    if (method === "eth_getLogs") {
      if (this.fault === "scan_error") throw new Error("canary_scan_secret");
      const filter = params[0] as Json, from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
      assert.ok(to - from + 1n <= 10n);
      const included = this.settlement?.included;
      if (included !== undefined && from <= BigInt(included.numberAtomic) && to >= BigInt(included.numberAtomic)) {
        return [structuredClone(this.settlement!.receipt.logs.at(-1))];
      }
      if (!["log_malformed", "log_truncated", "log_wrong_identity"].includes(this.fault)) return [];
      const at = this.block(from), log = scanLog(this.intent, this.finalHash ?? word(71n), word(72n), at);
      if (this.fault === "log_malformed") return ["malformed"];
      if (this.fault === "log_truncated") { delete log.blockHash; return [log]; }
      log.topics[1] = word(999n); return [log];
    }
    if (method === "eth_getTransactionByHash") {
      if (this.settlement === undefined) return null;
      return structuredClone(this.settlement.transaction);
    }
    if (method === "eth_getTransactionReceipt") {
      if (this.settlement === undefined || this.fault === "receipt_missing") return null;
      const receipt = structuredClone(this.settlement.receipt);
      if (this.fault === "receipt_conflict") receipt.blockHash = word(8080n);
      if (this.fault === "receipt_malformed") receipt.status = "0x2";
      return receipt;
    }
    const pinned = params.at(-1) as Json | undefined;
    const current = pinned?.blockHash !== initial.block.hash;
    if (method === "eth_getCode") {
      const address = String(params[0]).toLowerCase();
      if (address === this.intent.owner.address.toLowerCase()) {
        if (this.fault === "owner_code") return "0x6001";
        return initial.delegation === "empty" ? "0x" : `0xef0100${this.intent.delegate.slice(2).toLowerCase()}`;
      }
      if (this.fault === "protocol_code" && current && address === deployment.code[0]!.address.toLowerCase()) return "0x00";
      const code = this.codes.get(address); assert.ok(code, `unexpected code read ${address}`); return code;
    }
    if (method === "eth_getStorageAt") {
      const row = deployment.reads.find(read => read.kind === "storage" &&
        read.address.toLowerCase() === String(params[0]).toLowerCase() && read.data === params[1]);
      assert.ok(row, "unexpected storage read");
      return this.fault === "protocol_storage" && current ? word(77n) : row.expected;
    }
    if (method === "eth_getBalance") return "0x0";
    if (method === "eth_getTransactionCount") {
      const advanced = BigInt(initial.eoaNonceAtomic) + (initial.delegation === "empty" ? 1n : 0n);
      if (params[1] === "pending") return quantity(this.fault === "pending" ? advanced + 1n : advanced);
      return quantity(this.fault === "eoa" ? BigInt(initial.eoaNonceAtomic) : advanced);
    }
    if (method === "eth_call") {
      const call = params[0] as Json, data = call.data as string;
      const protocol = deployment.reads.find(read => read.kind === "call" &&
        read.address.toLowerCase() === String(call.to).toLowerCase() && read.data === data);
      if (protocol !== undefined) {
        return this.fault === "protocol_domain" && current && data === "0x3644e515" ? word(0n) : protocol.expected;
      }
      const number = this.pinnedNumber(pinned), invalidated = number >= this.invalidationAt;
      if (data.startsWith("0x70a08231")) return word(BigInt(initial.balanceAtomic) - 1n);
      if (data.startsWith("0xdd62ed3e")) return word(this.fault === "allowance" ? 1n : 0n);
      if (data.startsWith("0x7ecebe00")) return word(this.fault === "permit" || !invalidated
        ? BigInt(initial.permitNonceAtomic) : BigInt(initial.permitNonceAtomic) + 1n);
      if (data.startsWith("0x35567e1a")) return word(this.fault === "entrypoint" || !this.finalIdentity
        ? BigInt(initial.entryPointNonceAtomic) : BigInt(initial.entryPointNonceAtomic) + 1n);
    }
    throw new Error(`Unexpected observation RPC method: ${method}`);
  }

  private pinnedNumber(pinned: Json | undefined): bigint {
    assert.equal(pinned?.requireCanonical, true);
    const number = this.blockNumbers.get(String(pinned?.blockHash));
    assert.notEqual(number, undefined, `unknown pinned block ${String(pinned?.blockHash)}`);
    return number!;
  }

  private block(number: bigint): GaslessBlock {
    const initial = this.intent.initialSnapshot.block, start = BigInt(initial.numberAtomic);
    if (number === start) return initial;
    const block = { numberAtomic: number.toString(), hash: `0x${sha256(`observation-block-${number}`)}` as Hex,
      timestampAtomic: (BigInt(initial.timestampAtomic) + number - start).toString() };
    this.blockNumbers.set(block.hash, number);
    return block;
  }

  private rawBlock(number: bigint, hash: Hex, timestamp?: bigint): Json {
    this.blockNumbers.set(hash, number);
    return { number: quantity(number), hash, timestamp: quantity(timestamp ?? BigInt(this.block(number).timestampAtomic)),
      baseFeePerGas: "0x1", transactions: this.settlement?.included.numberAtomic === number.toString()
        ? [this.settlement.transactionHash] : [] };
  }
}

function settlementLogs(intent: GaslessIntent, userOperationHash: Hex): readonly GaslessLog[] {
  const prefund = BigInt(intent.feeCapAtomic) - 100n, refund = prefund / 4n, fee = prefund - refund;
  return [eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token,
    { owner: intent.owner.address, spender: intent.paymaster, value: BigInt(intent.feeCapAtomic) }, 0),
  eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token, { from: intent.owner.address, to: intent.paymaster, value: prefund }, 1),
  eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token,
    { from: intent.owner.address, to: intent.request.recipient, value: BigInt(intent.recipientAtomic) }, 2),
  eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token, { owner: intent.owner.address, spender: intent.paymaster, value: 0n }, 3),
  eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token, { from: intent.paymaster, to: intent.owner.address, value: refund }, 4),
  eventLog(GASLESS_PAYMASTER_ABI, "UserOperationSponsored", intent.paymaster, { token: intent.token,
    sender: intent.owner.address, userOpHash: userOperationHash, nativeTokenPrice: 2_500_000_000n,
    actualTokenNeeded: fee, feeTokenAmount: 1n }, 5),
  eventLog(GASLESS_ENTRYPOINT_ABI, "UserOperationEvent", intent.entryPoint, { userOpHash: userOperationHash,
    sender: intent.owner.address, paymaster: intent.paymaster, nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic),
    success: true, actualGasCost: 100n, actualGasUsed: 50n }, 6)];
}

function eventLog(abi: Abi, eventName: string, address: Address, args: Json, index: number): GaslessLog {
  const item = getAbiItem({ abi, name: eventName as never }) as any;
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  const topics = encodeEventTopics({ abi: [item], eventName: eventName as never, args: args as never }) as readonly Hex[];
  const plain = inputs.filter(input => !input.indexed) as readonly AbiParameter[];
  return { address, topics, data: encodeAbiParameters(plain, plain.map(input => args[input.name!]) as never),
    logIndexAtomic: String(index) };
}

function rawLog(log: GaslessLog, transactionHash: Hex, block: GaslessBlock): Json {
  return { address: log.address, topics: [...log.topics], data: log.data, logIndex: quantity(BigInt(log.logIndexAtomic)),
    transactionHash, blockHash: block.hash, blockNumber: quantity(BigInt(block.numberAtomic)), transactionIndex: "0x0", removed: false };
}

function scanLog(intent: GaslessIntent, userOperationHash: Hex, transactionHash: Hex, block: GaslessBlock): Json {
  return rawLog(eventLog(GASLESS_ENTRYPOINT_ABI, "UserOperationEvent", intent.entryPoint, { userOpHash: userOperationHash,
    sender: intent.owner.address, paymaster: intent.paymaster, nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic),
    success: true, actualGasCost: 100n, actualGasUsed: 50n }, 0), transactionHash, block);
}
