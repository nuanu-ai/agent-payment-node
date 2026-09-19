import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { GaslessTransport } from "../gasless/https.js";
import { rpcAddress, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord } from "../gasless/rpc-codec.js";
import type { Address, Hex } from "../model.js";
import type { UsdtAccountState, UsdtChainPort, UsdtSponsorPort } from "./engine.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
import type { UsdtChainReceipt } from "./receipt.js";
import type { UsdtUserOperation } from "./userop.js";

const MAX_RESPONSE = 1024 * 1024;
const SPONSOR_METHODS = new Set(["pimlico_getTokenQuotes", "pimlico_getUserOperationGasPrice", "pm_getPaymasterData",
  "eth_getUserOperationReceipt"]);
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
    } catch { throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless USDT RPC transport is unavailable.", { reason: "gasless_usdt_rpc_unavailable" }); }
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
    receiptLocator: async (userOpHash: Hex) => {
      const value = await rpc.call("eth_getUserOperationReceipt", [userOpHash]);
      if (value === null) return null;
      if (!isPlainRecord(value) || !isPlainRecord(value.receipt)) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_locator_shape");
      return rpcHex(value.receipt.transactionHash, 32, 32);
    },
  };
}

/** Canonical Ethereum reads through the owner's explicit `APN_ETHEREUM_RPC_URL`; no default endpoint exists. */
export function usdtChainPort(transport: GaslessTransport, rpcUrl: string): UsdtChainPort {
  const rpc = new UsdtJsonRpc(transport, rpcUrl, CHAIN_METHODS);
  const read = async (to: Address, data: Hex): Promise<Hex> => rpcHex(await rpc.call("eth_call", [{ to, data }, "latest"]));
  const codeHash = async (address: Address): Promise<Hex> => keccak256(rpcHex(await rpc.call("eth_getCode", [address, "latest"])));
  return {
    async verifyPins() {
      if (rpcQuantity(await rpc.call("eth_chainId", [])) !== 1n) usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_chain");
      for (const [address, expected] of [[USDT_GASLESS.token, USDT_GASLESS.tokenCodeHash], [USDT_GASLESS.entryPoint, USDT_GASLESS.entryPointCodeHash],
        [USDT_GASLESS.delegate, USDT_GASLESS.delegateCodeHash], [USDT_GASLESS.paymaster, USDT_GASLESS.paymasterCodeHash]] as const) {
        if (await codeHash(address) !== expected) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_code_drift");
      }
      const call = (functionName: "basisPointsRate" | "maximumFee" | "paused" | "entryPoint") =>
        encodeFunctionData({ abi: READS, functionName });
      if (rpcWord(await read(USDT_GASLESS.token, call("basisPointsRate"))) !== 0n ||
        rpcWord(await read(USDT_GASLESS.token, call("maximumFee"))) !== 0n) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_token_transfer_fee");
      }
      if (rpcWord(await read(USDT_GASLESS.token, call("paused"))) !== 0n) usdtFailure("APN_OPERATION_BLOCKED", "gasless_usdt_token_paused");
      const entryPoint = rpcAddress(`0x${(await read(USDT_GASLESS.paymaster, call("entryPoint"))).slice(26)}`);
      if (entryPoint !== USDT_GASLESS.entryPoint) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_entry_point");
    },
    async account(sender): Promise<UsdtAccountState> {
      const code = rpcHex(await rpc.call("eth_getCode", [sender, "latest"]));
      if (code !== "0x" && code !== DELEGATION) usdtFailure("APN_OPERATION_BLOCKED", "gasless_usdt_foreign_delegation");
      const balance = rpcWord(await read(USDT_GASLESS.token, encodeFunctionData({ abi: READS, functionName: "balanceOf", args: [sender] })));
      const entryPointNonce = rpcWord(await read(USDT_GASLESS.entryPoint,
        encodeFunctionData({ abi: READS, functionName: "getNonce", args: [sender, 0n] })));
      const eoaNonce = rpcQuantity(await rpc.call("eth_getTransactionCount", [sender, "latest"]));
      return { usdtBalanceAtomic: balance, entryPointNonce, eoaNonce, delegation: code === "0x" ? "empty" : "expected" };
    },
    async receiptAt(transactionHash) {
      const raw = await rpc.call("eth_getTransactionReceipt", [transactionHash]);
      if (raw === null) return null;
      const receipt = rpcRecord(raw), height = rpcQuantity(receipt.blockNumber);
      const safe = rpcRecord(await rpc.call("eth_getBlockByNumber", ["safe", false]));
      if (height > rpcQuantity(safe.number)) return null;
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
      return { transactionHash: transactionHash.toLowerCase() as Hex, blockNumber: height,
        status: status === 1n ? "success" : "reverted", logs } satisfies UsdtChainReceipt;
    },
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
