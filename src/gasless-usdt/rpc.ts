import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { GaslessTransport } from "../gasless/https.js";
import { RpcHttpFailure } from "../lifi/rpc-scheduler.js";
import { rpcAddress, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord } from "../gasless/rpc-codec.js";
import type { Address, Hex } from "../model.js";
import type { UsdtAccountState, UsdtSponsorPort } from "./engine.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
import type { UsdtChainReceipt } from "./receipt.js";
import type { UsdtRecoveryPort } from "./recovery.js";
import { scanUsdtUserOperation } from "./rpc-scan.js";
import type { UsdtUserOperation } from "./userop.js";

const MAX_RESPONSE = 1024 * 1024;
const SPONSOR_METHODS = new Set(["pimlico_getTokenQuotes", "pimlico_getUserOperationGasPrice", "pm_getPaymasterData"]);
const SEND_METHODS = new Set(["eth_sendUserOperation"]);
const CHAIN_METHODS = new Set(["eth_chainId", "eth_getCode", "eth_call", "eth_getTransactionCount", "eth_getTransactionReceipt",
  "eth_getBlockByNumber"]);
const READS = parseAbi(["function basisPointsRate() view returns (uint256)", "function maximumFee() view returns (uint256)",
  "function paused() view returns (bool)", "function balanceOf(address) view returns (uint256)",
  "function entryPoint() view returns (address)", "function getNonce(address sender, uint192 key) view returns (uint256)"]);
const DELEGATION = `0xef0100${USDT_GASLESS.delegate.slice(2).toLowerCase()}`;

/** One JSON-RPC exchange over the pinned public HTTPS transport; exact envelope, no retry, bounded provider text. */
export class UsdtJsonRpc {
  private sequence = 0;
  constructor(private readonly transport: GaslessTransport, private readonly endpoint: string,
    private readonly methods: ReadonlySet<string>) {}

  async call(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!this.methods.has(method)) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_method");
    const id = (++this.sequence).toString();
    let response: { readonly status: number; readonly body: string };
    try {
      response = await this.transport.request(this.endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }),
        MAX_RESPONSE, "APN_RPC_CONFIG");
    } catch (error) { throw rpcExchangeFailure(error, "single"); }
    if (response.status !== 200) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_http_status");
    const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error ||
      !exactKeys(record, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
      usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_envelope");
    }
    if (error) throw providerRefusal(method, record.error);
    return record.result;
  }

  /** One physical exchange. Every response must match exactly one requested id, in any order. */
  async batch(calls: readonly { readonly method: string; readonly params: readonly unknown[] }[],
    phase: "batch" | "safe_head" | "account_snapshot" = "batch"): Promise<readonly unknown[]> {
    if (calls.length < 1 || calls.length > 12 || calls.some(call => !this.methods.has(call.method))) {
      usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_method");
    }
    const requests = calls.map(call => ({ jsonrpc: "2.0", id: (++this.sequence).toString(), method: call.method,
      params: call.params }));
    let response: { readonly status: number; readonly body: string };
    try {
      response = await this.transport.request(this.endpoint, "POST", canonicalJson(requests), MAX_RESPONSE, "APN_RPC_CONFIG");
    } catch (error) { throw rpcExchangeFailure(error, phase); }
    if (response.status !== 200) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_http_status");
    const raw = rpcJson(response.body, MAX_RESPONSE);
    if (!Array.isArray(raw) || raw.length !== requests.length) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_batch_envelope");
    const expected = new Map(requests.map((request, index) => [request.id, index]));
    const values: unknown[] = new Array(requests.length);
    for (const item of raw) {
      const record = rpcRecord(item), index = typeof record.id === "string" ? expected.get(record.id) : undefined;
      const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
      if (index === undefined || record.jsonrpc !== "2.0" || result === error ||
        !exactKeys(record, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
        usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_batch_envelope");
      }
      expected.delete(record.id as string);
      if (error) throw providerRefusal(calls[index]!.method, record.error);
      values[index] = record.result;
    }
    if (expected.size !== 0) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_rpc_batch_envelope");
    return values;
  }
}

type UsdtCodeHashPins = Omit<import("./sponsor-auth.js").UsdtSponsorSnapshot["pins"], "paymasterEntryPoint">;
const PINNED_CODE = [[USDT_GASLESS.token, USDT_GASLESS.tokenCodeHash], [USDT_GASLESS.entryPoint, USDT_GASLESS.entryPointCodeHash],
  [USDT_GASLESS.delegate, USDT_GASLESS.delegateCodeHash], [USDT_GASLESS.paymaster, USDT_GASLESS.paymasterCodeHash]] as const;

/**
 * Code at an address cannot change on Ethereum (EIP-6780), and none of the four pinned contracts is a proxy. One verified
 * `eth_getCode` read per command invocation and RPC endpoint therefore proves them for every later safe snapshot of that
 * invocation; the storage-backed fee, pause and EntryPoint reads stay in every snapshot.
 */
export class UsdtCodePins {
  private proven: { readonly rpcUrl: string; readonly pins: UsdtCodeHashPins } | null = null;
  provenFor(rpcUrl: string): UsdtCodeHashPins | null { return this.proven?.rpcUrl === rpcUrl ? this.proven.pins : null; }
  prove(rpcUrl: string, codes: readonly unknown[]): UsdtCodeHashPins {
    const hashes = PINNED_CODE.map(([, expected], index) => {
      const hash = keccak256(rpcHex(codes[index]));
      if (hash !== expected) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_code_drift");
      return hash;
    });
    const pins = { token: hashes[0]!, entryPoint: hashes[1]!, delegate: hashes[2]!, paymaster: hashes[3]! };
    this.proven = { rpcUrl, pins };
    return pins;
  }
}

/** Read one authenticated safe-block account view. Every contract and account read uses the same safe tag. */
export async function usdtSafeSnapshot(transport: GaslessTransport, rpcUrl: string, sender: Address, codePins: UsdtCodePins): Promise<{
  readonly chainId: bigint; readonly blockNumber: bigint; readonly blockHash: Hex; readonly account: UsdtAccountState;
  readonly pins: import("./sponsor-auth.js").UsdtSponsorSnapshot["pins"];
}> {
  const rpc = new UsdtJsonRpc(transport, rpcUrl, CHAIN_METHODS);
  const [rawChainId, rawBlock] = await rpc.batch([
    { method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["safe", false] },
  ], "safe_head");
  const chainId = rpcQuantity(rawChainId);
  if (chainId !== 1n) usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_chain");
  const block = rpcRecord(rawBlock);
  const blockNumber = rpcQuantity(block.number), blockHash = rpcHex(block.hash, 32, 32);
  if (blockNumber < 1n) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_safe_block");
  const tag = { blockHash, requireCanonical: true };
  const call = (functionName: "basisPointsRate" | "maximumFee" | "paused" | "entryPoint") =>
    encodeFunctionData({ abi: READS, functionName });
  const proven = codePins.provenFor(rpcUrl);
  const codeReads = proven === null ? PINNED_CODE.map(([address]) => ({ method: "eth_getCode", params: [address, tag] })) : [];
  const calls = [
    ...codeReads,
    { method: "eth_call", params: [{ to: USDT_GASLESS.token, data: call("basisPointsRate") }, tag] },
    { method: "eth_call", params: [{ to: USDT_GASLESS.token, data: call("maximumFee") }, tag] },
    { method: "eth_call", params: [{ to: USDT_GASLESS.token, data: call("paused") }, tag] },
    { method: "eth_call", params: [{ to: USDT_GASLESS.paymaster, data: call("entryPoint") }, tag] },
    { method: "eth_getCode", params: [sender, tag] },
    { method: "eth_call", params: [{ to: USDT_GASLESS.token, data: encodeFunctionData({ abi: READS,
      functionName: "balanceOf", args: [sender] }) }, tag] },
    { method: "eth_call", params: [{ to: USDT_GASLESS.entryPoint, data: encodeFunctionData({ abi: READS,
      functionName: "getNonce", args: [sender, 0n] }) }, tag] },
    { method: "eth_getTransactionCount", params: [sender, tag] },
  ];
  const all = await rpc.batch(calls, "account_snapshot");
  const pins = proven ?? codePins.prove(rpcUrl, all.slice(0, codeReads.length));
  const values = all.slice(codeReads.length);
  if (rpcWord(values[0]) !== 0n || rpcWord(values[1]) !== 0n) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_token_transfer_fee");
  }
  if (rpcWord(values[2]) !== 0n) usdtFailure("APN_OPERATION_BLOCKED", "gasless_usdt_token_paused");
  const paymasterEntryPoint = rpcAddress(`0x${rpcHex(values[3]).slice(26)}`);
  if (paymasterEntryPoint !== USDT_GASLESS.entryPoint) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_entry_point");
  const code = rpcHex(values[4]);
  if (code !== "0x" && code !== DELEGATION) usdtFailure("APN_OPERATION_BLOCKED", "gasless_usdt_foreign_delegation");
  const usdtBalanceAtomic = rpcWord(values[5]);
  const entryPointNonce = rpcWord(values[6]);
  const eoaNonce = rpcQuantity(values[7]);
  return { chainId, blockNumber, blockHash, pins: { ...pins, paymasterEntryPoint },
    account: { usdtBalanceAtomic, entryPointNonce, eoaNonce, delegation: code === "0x" ? "empty" : "expected" } };
}

function rpcExchangeFailure(error: unknown, rpcPhase: "single" | "batch" | "safe_head" | "account_snapshot"): ApnError {
  if (error instanceof RpcHttpFailure) {
    const rateLimited = error.status === 429;
    return new ApnError(rateLimited ? "APN_RPC_RATE_LIMITED" : "APN_RPC_AMBIGUOUS",
      rateLimited ? "Gasless USDT RPC rate limited the request." : "Gasless USDT RPC returned a server error.",
      { reason: rateLimited ? "gasless_usdt_rpc_rate_limited" : "gasless_usdt_rpc_server_error",
        rpcPhase, httpStatus: error.status,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) });
  }
  if (error instanceof ApnError && error.code === "APN_PROVIDER_UNAVAILABLE" &&
    error.details?.reason === "rpc_provider_cooldown") {
    return new ApnError("APN_PROVIDER_UNAVAILABLE", "Gasless USDT RPC provider is cooling down.",
      { reason: "rpc_provider_cooldown", rpcPhase });
  }
  if (error instanceof ApnError && error.code === "APN_RPC_CONFIG") {
    const reason = error.details?.reason === "gasless_usdt_read_budget" ? "gasless_usdt_read_budget" : "gasless_usdt_rpc_config";
    return new ApnError("APN_RPC_CONFIG", "Gasless USDT RPC request could not start.", { reason, rpcPhase });
  }
  if (error instanceof ApnError && error.details?.reason === "gasless_usdt_read_deadline") {
    return new ApnError("APN_RPC_AMBIGUOUS", "Gasless USDT RPC read deadline expired.",
      { reason: "gasless_usdt_read_deadline", rpcPhase });
  }
  return new ApnError("APN_RPC_AMBIGUOUS", "Gasless USDT RPC transport is unavailable.",
    { reason: "gasless_usdt_rpc_transport", rpcPhase });
}

/**
 * The keyless sponsor is the mechanism itself: Pimlico's public endpoint for chain 1, fixed, never configurable, so the
 * paymaster named by the capability registry is the one the owner's allowlist pin names.
 */
export function usdtSponsorPort(transport: GaslessTransport): UsdtSponsorPort {
  const rpc = new UsdtJsonRpc(transport, USDT_GASLESS.bundlerUrl, SPONSOR_METHODS);
  return {
    tokenQuote: async () => await rpc.call("pimlico_getTokenQuotes", [{ tokens: [USDT_GASLESS.token] }, USDT_GASLESS.entryPoint, "0x1"]),
    gasPrice: async () => await rpc.call("pimlico_getUserOperationGasPrice", []),
    paymasterData: async (op: UsdtUserOperation) => await rpc.call("pm_getPaymasterData",
      [op, USDT_GASLESS.entryPoint, "0x1", { token: USDT_GASLESS.token }]),
  };
}

/** A single keyless Pimlico dispatch. The caller must persist its submitting intent first. */
export function usdtSendPort(transport: GaslessTransport): (op: UsdtUserOperation) => Promise<Hex> {
  const rpc = new UsdtJsonRpc(transport, USDT_GASLESS.bundlerUrl, SEND_METHODS);
  return async op => rpcHex(await rpc.call("eth_sendUserOperation", [op, USDT_GASLESS.entryPoint]), 32, 32);
}

/** One keyless locator read and bounded public chain reads; the caller supplies its paced transport. */
export function usdtRecoveryPort(transport: GaslessTransport, rpcUrl: string): UsdtRecoveryPort {
  const sponsor = new UsdtJsonRpc(transport, USDT_GASLESS.bundlerUrl, new Set(["eth_getUserOperationReceipt"]));
  const chainRpc = new UsdtJsonRpc(transport, rpcUrl, new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getLogs"]));
  const receiptAt = usdtReceiptAt(transport, rpcUrl);
  // One pass talks to one endpoint; its chain identity is proved once, by the scan batch or the first receipt read.
  let chainProven = false;
  return {
    async userOperationReceipt(hash) {
      const raw = await sponsor.call("eth_getUserOperationReceipt", [hash]);
      if (raw === null) return null;
      const value = rpcRecord(raw), outer = rpcRecord(value.receipt);
      if (typeof value.success !== "boolean") usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_userop_receipt_success");
      const transactionHash = rpcHex(outer.transactionHash, 32, 32);
      return { userOpHash: rpcHex(value.userOpHash, 32, 32), sender: rpcAddress(value.sender),
        entryPoint: rpcAddress(value.entryPoint), paymaster: rpcAddress(value.paymaster), success: value.success,
        transactionHash };
    },
    async canonicalFinalizedReceipt(transactionHash) {
      if (!chainProven && rpcQuantity(await chainRpc.call("eth_chainId", [])) !== 1n) usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_chain");
      chainProven = true;
      return await receiptAt(transactionHash, "finalized");
    },
    async scanUserOperation(input) {
      const scan = await scanUsdtUserOperation(chainRpc, input);
      chainProven = true;
      return scan;
    },
  };
}

/** Canonical finalized-or-safe receipt read through the owner's explicit `APN_ETHEREUM_RPC_URL`; no default endpoint exists. */
function usdtReceiptAt(transport: GaslessTransport, rpcUrl: string): (transactionHash: Hex, finality?: "safe" | "finalized") => Promise<UsdtChainReceipt | null> {
  const rpc = new UsdtJsonRpc(transport, rpcUrl, CHAIN_METHODS);
  return async (transactionHash, finality = "safe") => {
    const raw = await rpc.call("eth_getTransactionReceipt", [transactionHash]);
    if (raw === null) return null;
    const receipt = rpcRecord(raw), height = rpcQuantity(receipt.blockNumber);
    const head = rpcRecord(await rpc.call("eth_getBlockByNumber", [finality, false]));
    if (height > rpcQuantity(head.number)) return null;
    const block = rpcRecord(await rpc.call("eth_getBlockByNumber", [`0x${height.toString(16)}`, false]));
    if (rpcHex(block.hash, 32, 32) !== rpcHex(receipt.blockHash, 32, 32) || rpcHex(receipt.transactionHash, 32, 32) !== transactionHash.toLowerCase()) {
      usdtFailure("APN_RPC_AMBIGUOUS", "gasless_usdt_receipt_not_canonical");
    }
    if (!Array.isArray(receipt.logs)) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_receipt_logs");
    const logs = receipt.logs.map((entry: unknown) => {
      const log = rpcRecord(entry);
      if (!Array.isArray(log.topics)) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_receipt_logs");
      return { address: rpcAddress(log.address), topics: log.topics.map((topic: unknown) => rpcHex(topic, 32, 32)), data: rpcHex(log.data) };
    });
    const status = rpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) usdtFailure("APN_RPC_PROTOCOL", "gasless_usdt_receipt_status");
    return { transactionHash: transactionHash.toLowerCase() as Hex, blockNumber: height,
      status: status === 1n ? "success" : "reverted", logs } satisfies UsdtChainReceipt;
  };
}

function providerRefusal(method: string, value: unknown): ApnError {
  const message = isPlainRecord(value) && typeof value.message === "string" ? value.message : "";
  const bounded = message.replace(/[^\x20-\x7e]/gu, "?").slice(0, 240);
  const simulation = /AA[0-9]{2}|reverted during simulation/u.test(message);
  return new ApnError(simulation ? "APN_PROVIDER_EFFECT_UNAVAILABLE" : "APN_PROVIDER_PROTOCOL",
    `The keyless sponsor refused ${method}: ${bounded}`,
    { reason: simulation ? "gasless_usdt_sponsor_simulation_refused" : "gasless_usdt_sponsor_refused", rail: "gasless", method });
}
