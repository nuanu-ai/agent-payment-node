import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "../../src/canonical.js";
import type { Address } from "../../src/model.js";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import type { BridgeLog, BridgeTool } from "../../src/lifi/model.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";

type Rpc = { readonly id: string; readonly method: string; readonly params: readonly any[] };
export type LifecycleRoute = readonly [chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address];
export interface LifecyclePost { readonly host: string; readonly role: "primary" | "archive"; readonly chainId: number; readonly methods: readonly string[] }
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const RELAYER_KEY = `0x${"07".repeat(32)}` as Hex;

/**
 * A two-chain JSON-RPC double for whole bridge lifecycles over the production adapter. Every POST is recorded with its
 * endpoint role. Sends stay pending until `mine`, inclusion is safe only after `finalize`; registry pins answer their
 * reviewed values and code answers captured runtime bytecode.
 */
export function lifecycleDouble(routes: readonly LifecycleRoute[], code: ReadonlyMap<string, Hex>, options: {
  readonly nowSeconds: bigint; readonly owner: Address; readonly nonce: bigint; readonly allowanceAfterApproval: bigint;
  /** Receipt logs of a sent source transaction, by its `to` address (lowercase). */
  readonly sourceLogs: (to: string) => readonly BridgeLog[];
}) {
  const expected = new Map<string, Hex>(), key = (chainId: number, kind: string, address: string, data: string) =>
    canonicalJson([chainId, kind, address.toLowerCase(), data.toLowerCase()]);
  for (const [chainId, peer, tool, token] of routes) {
    for (const row of bridgeDeployment(chainId, peer, tool, token).reads) {
      expected.set(key(chainId, row.kind, row.address, row.data), row.expected);
    }
  }
  const chains = new Map<number, { latest: bigint; safe: bigint; mined: Map<bigint, string[]>; pending: string[] }>();
  const chain = (chainId: number) => {
    let state = chains.get(chainId);
    if (state === undefined) chains.set(chainId, state = { latest: 1000n, safe: 990n, mined: new Map(), pending: [] });
    return state;
  };
  const transactions = new Map<string, { chainId: number; raw?: Hex; tx: Record<string, unknown>; receipt: Record<string, unknown>; block: bigint | null }>();
  const posts: LifecyclePost[] = [], sent: Hex[] = [];
  let allowance = 0n, minedNonces = 0n;
  const blockHash = (chainId: number, number: bigint) => word((BigInt(chainId) << 64n) + number + 1n);
  const block = (chainId: number, tag: unknown) => {
    const c = chain(chainId), number = tag === "safe" ? c.safe : tag === "latest" ? c.latest : BigInt(String(tag));
    return { number: `0x${number.toString(16)}`, hash: blockHash(chainId, number), parentHash: blockHash(chainId, number - 1n),
      timestamp: `0x${(options.nowSeconds - c.latest + number).toString(16)}`, baseFeePerGas: "0x1", transactions: c.mined.get(number) ?? [] };
  };
  const call = (chainId: number, request: { to: string; data: string }, tag: unknown): Hex => {
    if (request.to.toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: request.data as Hex });
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: (decoded.args![0] as readonly { target: string; callData: Hex }[])
        .map((row) => ({ success: true, returnData: call(chainId, { to: row.target, data: row.callData }, tag) })) });
    }
    const pinned = expected.get(key(chainId, "call", request.to, request.data));
    if (pinned !== undefined) return pinned;
    if (request.data.startsWith("0xdd62ed3e")) return word(allowance);
    if (request.data.startsWith("0x70a08231")) return word(100_000_000n);
    return word(0n);
  };
  const answer = (chainId: number, { method, params }: Rpc): unknown => {
    const c = chain(chainId);
    if (method === "eth_sendRawTransaction") { sent.push(params[0]); c.pending.push(record(params[0] as Hex)); return keccak256(params[0]); }
    if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (method === "eth_getBlockByNumber") return block(chainId, params[0]);
    const known = transactions.get(String(params[0]));
    if (method === "eth_getTransactionByHash") return known?.block === null || known === undefined ? null : known.tx;
    if (method === "eth_getTransactionReceipt") return known?.block === null || known === undefined ? null : known.receipt;
    if (method === "eth_getCode") return code.get(`${chainId}:${String(params[0]).toLowerCase()}`) ?? "0x6000";
    if (method === "eth_getStorageAt") return expected.get(key(chainId, "storage", params[0], params[1])) ?? assert.fail(`unpinned storage ${canonicalJson(params)}`);
    if (method === "eth_call") return call(chainId, params[0], params[1]);
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_getTransactionCount") return `0x${(options.nonce + minedNonces + (params[1] === "pending" ? BigInt(c.pending.length) : 0n)).toString(16)}`;
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_estimateGas") return "0x186a0";
    return assert.fail(`unexpected read ${method}`);
  };
  const record = (raw: Hex): string => {
    const t = parseTransaction(raw), hash = keccak256(raw), chainId = t.chainId!, gasUsed = t.gas! < 55_437n ? t.gas! : 55_437n;
    const logs = options.sourceLogs(String(t.to).toLowerCase());
    transactions.set(hash, { chainId, raw, block: null, tx: { hash, type: "0x2", chainId: `0x${chainId.toString(16)}`, from: options.owner, to: t.to,
      nonce: `0x${BigInt(t.nonce!).toString(16)}`, gas: `0x${t.gas!.toString(16)}`, value: `0x${(t.value ?? 0n).toString(16)}`, input: t.data ?? "0x",
      maxFeePerGas: `0x${t.maxFeePerGas!.toString(16)}`, maxPriorityFeePerGas: `0x${t.maxPriorityFeePerGas!.toString(16)}`, accessList: [],
      r: t.r, s: t.s, yParity: `0x${t.yParity}`, v: `0x${t.yParity}` },
    receipt: { transactionHash: hash, from: options.owner, to: t.to, type: "0x2", status: "0x1", gasUsed: `0x${gasUsed.toString(16)}`,
      effectiveGasPrice: `0x${t.maxFeePerGas!.toString(16)}`,
      ...(chainId === 8453 ? { l1Fee: "0x2c50fa21", daFootprintGasScalar: "0x94" } : chainId === 42161 ? { gasUsedForL1: "0x0" } : {}),
      logs: logs.map((log) => ({ ...log, transactionHash: hash, removed: false })) } });
    return hash;
  };
  /** Includes every pending send, and the given foreign transactions, in the next block. */
  const mine = (chainId: number, foreign: readonly string[] = []) => {
    const c = chain(chainId), number = c.latest + 1n, hashes = [...c.pending, ...foreign];
    c.latest = number; c.mined.set(number, hashes); c.pending = [];
    for (const [index, hash] of hashes.entries()) {
      const row = transactions.get(hash)!, placed = { blockHash: blockHash(chainId, number), blockNumber: `0x${number.toString(16)}`, transactionIndex: `0x${index.toString(16)}` };
      row.block = number; Object.assign(row.tx, placed);
      row.receipt = { ...row.receipt, ...placed, logs: (row.receipt.logs as Record<string, unknown>[]).map((log, logIndex) => ({ ...log, ...placed, logIndex: `0x${logIndex.toString(16)}` })) };
      if (row.raw !== undefined) {
        minedNonces += 1n;
        allowance = String(row.tx.input).startsWith("0x095ea7b3") ? options.allowanceAfterApproval : 0n;
      }
    }
  };
  const finalize = (chainId: number) => { chain(chainId).safe = chain(chainId).latest; };
  /** A relayer-signed destination transaction with the given receipt logs, mined into the next destination block. */
  const destination = async (chainId: BridgeChainId, to: Address, logs: readonly BridgeLog[]): Promise<Hex> => {
    const relayer = privateKeyToAccount(RELAYER_KEY);
    const raw = await relayer.signTransaction({ chainId, type: "eip1559", nonce: 9, gas: 200_000n, maxFeePerGas: 10_000_000n,
      maxPriorityFeePerGas: 0n, to, value: 0n, data: "0x1234" });
    const t = parseTransaction(raw), hash = keccak256(raw);
    transactions.set(hash, { chainId, block: null, tx: { hash, type: "0x2", chainId: `0x${chainId.toString(16)}`, from: relayer.address, to,
      nonce: "0x9", gas: `0x${t.gas!.toString(16)}`, value: "0x0", input: "0x1234", maxFeePerGas: `0x${t.maxFeePerGas!.toString(16)}`,
      maxPriorityFeePerGas: "0x0", accessList: [], r: t.r, s: t.s, yParity: `0x${t.yParity}`, v: `0x${t.yParity}` },
    receipt: { transactionHash: hash, from: relayer.address, to, type: "0x2", status: "0x1", gasUsed: "0x30d40", effectiveGasPrice: "0x989680",
      gasUsedForL1: "0x0", logs: logs.map((log) => ({ ...log, transactionHash: hash, removed: false })) } });
    mine(chainId, [hash]);
    return hash;
  };
  const transport = { request: async (endpoint: string, verb: string, body: string | null) => {
    assert.equal(verb, "POST");
    const host = new URL(endpoint).host, match = /^(rpc|archive)-(\d+)\.example$/u.exec(host);
    assert(match !== null, `unexpected host ${host}`);
    const chainId = Number(match[2]), role = match[1] === "rpc" ? "primary" as const : "archive" as const;
    const parsed = JSON.parse(body!) as Rpc | Rpc[], rows = Array.isArray(parsed) ? parsed : [parsed];
    posts.push({ host, role, chainId, methods: rows.map((row) => row.method) });
    const values = rows.map((row) => ({ jsonrpc: "2.0", id: row.id, result: answer(chainId, row) }));
    return { status: 200, headers: {}, body: JSON.stringify(Array.isArray(parsed) ? values : values[0]) };
  } };
  return { transport, posts, sent, mine, finalize, destination };
}
