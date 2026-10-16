import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, type Hex } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import type { Address } from "../../src/model.js";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import type { BridgeTool } from "../../src/lifi/model.js";
import { BRIDGE_ARCHIVE_RPC_ENV, BRIDGE_RECEIPT_RPC_ENV } from "../../src/lifi/rpc-archive.js";
import { BASE_FEE_CONTRACT } from "../../src/lifi/rpc-fees.js";
import { BRIDGE_RPC_ENV } from "../../src/lifi/rpc.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
import { LIFI_SYNTHETIC_SENDER } from "./lifi-helpers.js";

/** primary: the primary returns the receipt; fallback: it returns null and the archive serves it; batch: a three-item receipt reader; scalar: mainnet.base.org. */
export type ReceiptRoute = "primary" | "fallback" | "batch" | "scalar";
export type ChainRoute = readonly [chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address];
type Rpc = { readonly id: string; readonly method: string; readonly params: readonly any[] };
export const INCLUDED_BLOCK = 2000n;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const APPROVAL_TOPIC = keccak256(Buffer.from("Approval(address,address,uint256)"));

/** Runtime bytecode captured read-only from mainnet, keyed by chain and lowercase address. */
export async function capturedBytecode(): Promise<ReadonlyMap<string, Hex>> {
  const json = async (name: string) => JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", name), "utf8"));
  const code = new Map<string, Hex>(), put = (chainId: number, address: string, bytes: Hex) => code.set(`${chainId}:${address.toLowerCase()}`, bytes);
  for (const chain of (await json("deployment-rpc-20260908.json")).chains) for (const row of chain.requests) {
    if (row.request.method === "eth_getCode") put(chain.chainId, row.request.params[0], row.response.result);
  }
  for (const row of (await json("wrapped-native-runtime-blockscout-20260922.json")).contracts) put(row.chainId, row.address, row.deployedBytecode);
  for (const row of (await json("wbtc-runtime-readonly-20261009.json")).rows) put(row.chainId, row.address, row.result);
  for (const row of (await json("base-native-across-observation-rpc-20261008.json")).rows) if (row.method === "eth_getCode") put(8453, row.params[0], row.result);
  for (const [chainId, name] of [[59144, "deployment-linea-rpc-20260921.json"], [143, "deployment-monad-rpc-20260920.json"]] as const) {
    for (const row of (await json(name)).requests) if (row.request.method === "eth_getCode") put(chainId, row.request.params[0], row.response.result);
  }
  for (const chainId of [1, 8453, 42161]) put(chainId, MULTICALL3_ADDRESS, (await readFile(resolve("tests/core/fixtures/multicall3-runtime-code.hex"), "utf8")).trim() as Hex);
  return code;
}

export function chainEnvironment(chains: readonly BridgeChainId[], receipt: ReceiptRoute): Record<string, string> {
  return Object.fromEntries(chains.flatMap((chainId) => [
    [BRIDGE_RPC_ENV[chainId], `https://rpc-${chainId}.example`], [BRIDGE_ARCHIVE_RPC_ENV[chainId], `https://archive-${chainId}.example`],
    ...(receipt === "batch" ? [[BRIDGE_RECEIPT_RPC_ENV[chainId], `https://receipt-${chainId}.example`]] : []),
    ...(receipt === "scalar" && chainId === 8453 ? [[BRIDGE_RECEIPT_RPC_ENV[chainId], "https://mainnet.base.org"]] : []),
  ]));
}

/**
 * A read-only chain double. Pinned deployment and Base fee reads answer their reviewed values, code answers captured
 * runtime bytecode (or bytes that cannot verify), and registered signed transactions are included at block 2000.
 */
export function chainDouble(routes: readonly ChainRoute[], code: ReadonlyMap<string, Hex>, receipt: ReceiptRoute, options: {
  readonly nowSeconds: bigint; readonly allowance?: bigint; readonly nonce?: bigint;
  /** callTracer answers for `debug_traceTransaction`, by transaction hash. */
  readonly trace?: (hash: string) => unknown;
}) {
  const expected = new Map<string, Hex>(), key = (chainId: number, kind: string, address: string, data: string) =>
    canonicalJson([chainId, kind, address.toLowerCase(), data.toLowerCase()]);
  for (const [chainId, peer, tool, token] of routes) {
    for (const row of [...bridgeDeployment(chainId, peer, tool, token).reads, ...(chainId === 8453 ? BASE_FEE_CONTRACT.reads : [])]) {
      expected.set(key(chainId, row.kind, row.address, row.data), row.expected);
    }
  }
  const transactions = new Map<string, { tx: Record<string, unknown>; receipt: Record<string, unknown> }>();
  const posts: Array<{ host: string; role: string; methods: string[] }> = [];
  const blockHash = (chainId: number, number: bigint) => word((BigInt(chainId) << 64n) + number + 1n);
  const block = (chainId: number, tag: string) => {
    const number = tag === "safe" ? INCLUDED_BLOCK + 1n : tag === "latest" ? INCLUDED_BLOCK + 2n : BigInt(tag);
    return { number: `0x${number.toString(16)}`, hash: blockHash(chainId, number), parentHash: blockHash(chainId, number - 1n),
      timestamp: `0x${(options.nowSeconds - INCLUDED_BLOCK - 2n + number).toString(16)}`, baseFeePerGas: "0x3b9aca00",
      transactions: number === INCLUDED_BLOCK ? [...transactions.entries()].filter(([, row]) => row.tx.chainId === `0x${chainId.toString(16)}`).map(([hash]) => hash) : [] };
  };
  const call = (chainId: number, request: { to: string; data: string }, tag: unknown): Hex => {
    if (request.to.toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: request.data as Hex });
      assert.equal(decoded.functionName, "aggregate3");
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: (decoded.args![0] as readonly { target: string; callData: Hex }[])
        .map((row) => ({ success: true, returnData: call(chainId, { to: row.target, data: row.callData }, tag) })) });
    }
    const pinned = expected.get(key(chainId, "call", request.to, request.data));
    if (pinned !== undefined) return pinned;
    if (request.data.startsWith("0xdd62ed3e")) return word(options.allowance ?? 0n);
    if (request.data.startsWith("0x70a08231")) return word(100_000_000n);
    return word(0n);
  };
  const answer = (chainId: number, role: string, { method, params }: Rpc): unknown => {
    assert.notEqual(method, "eth_sendRawTransaction", "a read-only chain double never accepts a send");
    if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (method === "eth_getBlockByNumber") return block(chainId, params[0]);
    if (method === "eth_getTransactionByHash") return transactions.get(params[0])?.tx ?? null;
    if (method === "eth_getTransactionReceipt") return receipt === "fallback" && role === "primary" ? null : transactions.get(params[0])?.receipt ?? null;
    if (method === "eth_getCode") return code.get(`${chainId}:${String(params[0]).toLowerCase()}`) ?? "0x6000";
    if (method === "eth_getStorageAt") return expected.get(key(chainId, "storage", params[0], params[1])) ?? assert.fail(`unpinned storage ${canonicalJson(params)}`);
    if (method === "eth_call") return call(chainId, params[0], params[1]);
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_getTransactionCount") return `0x${(options.nonce ?? 3n).toString(16)}`;
    if (method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "debug_traceTransaction" && options.trace !== undefined) return options.trace(params[0]);
    return assert.fail(`unexpected read ${method}`);
  };
  const transport = { request: async (endpoint: string, verb: string, body: string | null) => {
    assert.equal(verb, "POST");
    const host = new URL(endpoint).host, match = /^(rpc|archive|receipt)-(\d+)\.example$/u.exec(host);
    const chainId = host === "mainnet.base.org" ? 8453 : Number(match?.[2]), role = match?.[1] === "rpc" ? "primary" : match?.[1] ?? "receipt";
    const parsed = JSON.parse(body!) as Rpc | Rpc[], rows = Array.isArray(parsed) ? parsed : [parsed];
    posts.push({ host, role, methods: rows.map((row) => row.method) });
    const values = rows.map((row) => ({ jsonrpc: "2.0", id: row.id, result: answer(chainId, role, row) }));
    return { status: 200, headers: {}, body: JSON.stringify(Array.isArray(parsed) ? values : values[0]) };
  } };
  /** Includes one signed transaction with a successful receipt, an exact approval log when given, and pinned fee fields. */
  const include = (raw: Hex, approval?: { token: Address; spender: Address; amount: bigint }) => {
    const t = parseTransaction(raw), hash = keccak256(raw), chainId = t.chainId!, included = block(chainId, INCLUDED_BLOCK.toString());
    const placed = { blockHash: included.hash, blockNumber: included.number, transactionIndex: "0x0" };
    const gasUsed = t.gas! < 55_437n ? t.gas! : 55_437n, l1Fee = chainId === 8453 ? 743_479_265n : 0n;
    transactions.set(hash, { tx: { ...placed, hash, type: "0x2", chainId: `0x${chainId.toString(16)}`, from: LIFI_SYNTHETIC_SENDER, to: t.to,
      nonce: `0x${BigInt(t.nonce!).toString(16)}`, gas: `0x${t.gas!.toString(16)}`, value: `0x${(t.value ?? 0n).toString(16)}`, input: t.data ?? "0x",
      maxFeePerGas: `0x${t.maxFeePerGas!.toString(16)}`, maxPriorityFeePerGas: `0x${t.maxPriorityFeePerGas!.toString(16)}`, accessList: [],
      r: t.r, s: t.s, yParity: `0x${t.yParity}`, v: `0x${t.yParity}` },
    receipt: { ...placed, transactionHash: hash, from: LIFI_SYNTHETIC_SENDER, to: t.to, type: "0x2", status: "0x1",
      gasUsed: `0x${gasUsed.toString(16)}`, effectiveGasPrice: `0x${t.maxFeePerGas!.toString(16)}`,
      ...(chainId === 8453 ? { l1Fee: `0x${l1Fee.toString(16)}`, daFootprintGasScalar: "0x0" } : chainId === 42161 ? { gasUsedForL1: "0x0" } : {}),
      logs: approval === undefined ? [] : [{ ...placed, address: approval.token, transactionHash: hash, logIndex: "0x0", removed: false,
        topics: [APPROVAL_TOPIC, word(BigInt(LIFI_SYNTHETIC_SENDER)), word(BigInt(approval.spender))], data: word(approval.amount) }] } });
    return { hash, gasUsed, price: t.maxFeePerGas!, l1Fee };
  };
  return { transport, posts, include };
}
