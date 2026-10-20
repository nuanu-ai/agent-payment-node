import { canonicalJson, domainHash } from "../../src/canonical.js";
import { keccak256, parseTransaction, type Hex } from "viem";
import { SecureStateStore } from "../../src/secure-state-store.js";
import type { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT, UNISWAP_V3_QUOTER_V2, USDC_IMPLEMENTATION_PIN, USDC_IMPLEMENTATION_SLOT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { UNISWAP_V3_SWAP_ROUTER, UNISWAP_V3_USDC_USDT_100 } from "../../src/swap/uniswap-v3/token-route.js";
import { createTokenRpc, tokenBatch, type TokenRpcCall, type TokenRpcItem } from "../../src/swap/uniswap-v3/token-rpc.js";

export const WRAPPING = { load: async () => Buffer.alloc(32, 52), create: async () => Buffer.alloc(32, 52) };
export const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const hex = (value: bigint) => `0x${value.toString(16)}`;
export const blockHash = (number: bigint) => `0x${"b".repeat(48)}${number.toString(16).padStart(16, "0")}`;

/**
 * A fake Ethereum node whose head moves: every `latest` read is a new block, as on mainnet across one command. State reads
 * at any block answer the current values; transactions land where a test puts them.
 */
export function movingNode(input: { readonly account: string; readonly allowance: string; readonly pending: bigint }) {
  const node = { rpcNow: Date.now(), head: 1_000n, baseFee: 1n, allowance: input.allowance, pending: input.pending, finalizedNonce: 0n, finalizedLag: 64n,
    sends: [] as Hex[], txs: new Map<string, Record<string, unknown>>(), receipts: new Map<string, Record<string, unknown>>(), methods: [] as string[] };
  const block = (number: bigint) => ({ number: hex(number), hash: blockHash(number), parentHash: blockHash(number - 1n), baseFeePerGas: hex(node.baseFee) });
  const value = (method: string, params: readonly unknown[]): unknown => {
    node.methods.push(method);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") { const tag = String(params[0]);
      if (tag === "latest") { node.head += 1n; return block(node.head); }
      if (tag === "safe") return block(node.head - 2n);
      if (tag === "finalized") return block(node.head - node.finalizedLag);
      return block(BigInt(tag)); }
    if (method === "eth_getTransactionCount") return hex(params[1] === "finalized" ? node.finalizedNonce : node.pending);
    if (method === "eth_getCode") return "0x00"; if (method === "eth_getStorageAt") return word(0n);
    if (method === "eth_getBalance") return "0xffffffffffffffff"; if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_call") { const tx = params[0] as { readonly to?: string; readonly data?: string }, data = String(tx.data ?? "");
      if (tx.to === UNISWAP_V3_QUOTER_V2) return `0x${[999_000n, 0n, 0n, 0n].map((v) => word(v).slice(2)).join("")}`;
      if (data.startsWith("0xdd62ed3e")) return word(BigInt(node.allowance)); if (data.startsWith("0x70a08231")) return word(10_000_000n);
      return word(1n); }
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; node.sends.push(raw); return keccak256(raw); }
    if (method === "eth_getTransactionByHash") return node.txs.get(String(params[0])) ?? null;
    if (method === "eth_getTransactionReceipt") return node.receipts.get(String(params[0])) ?? null;
    throw new Error(`unexpected RPC method ${method}`);
  };
  /** The signed transaction lands in a block; its account nonce moves past it. */
  const land = (raw: Hex, number: bigint, status: 0 | 1 = 1) => {
    const tx = parseTransaction(raw), hash = keccak256(raw), at = { blockNumber: hex(number), blockHash: blockHash(number) };
    node.txs.set(hash, { hash, chainId: "0x1", from: input.account, to: tx.to, input: tx.data, value: "0x0", nonce: hex(BigInt(tx.nonce!)),
      gas: hex(tx.gas!), maxFeePerGas: hex(tx.maxFeePerGas!), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas!), type: "0x2", ...at });
    node.receipts.set(hash, { transactionHash: hash, from: input.account, to: tx.to, status: hex(BigInt(status)), gasUsed: "0x5208",
      effectiveGasPrice: hex(node.baseFee + 1n), ...at });
    if (BigInt(tx.nonce!) >= node.pending) node.pending = BigInt(tx.nonce!) + 1n;
    return hash;
  };
  const request = async (_url: string, _method: string, body: string | null) => { const parsed = JSON.parse(body!) as unknown;
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as { readonly id: string; readonly method: string; readonly params: readonly unknown[] }[];
    const answers = rows.map((row) => ({ jsonrpc: "2.0", id: row.id, result: value(row.method, row.params) }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? answers : answers[0]) }; };
  return { node, land, request, block };
}

/**
 * One command's production token RPC session (scalar primary plus distinct archive, or a one-candidate pool) over the node.
 * Every session shares the node's pacing clock, which only moves forward, as the provider pacing stored in state requires.
 */
export function tokenSession(state: StateStore, chain: ReturnType<typeof movingNode>, maxHttpRequests: number, pooled = false): TokenRpcCall {
  const node = chain.node;
  return createTokenRpc({ environment: { ...(pooled ? { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify(["https://rpc.example"]) }
    : { APN_ETHEREUM_RPC_URL: "https://rpc.example" }), APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" }, state,
  now: () => node.rpcNow, pacingNow: () => node.rpcNow, wait: async (milliseconds) => { node.rpcNow += milliseconds; }, maxHttpRequests, deadlineMs: 300_000,
  transport: { request: chain.request } });
}

/**
 * The code pins' reads with the production batch shapes (scalar: the archive chain id rides in the first of four batches;
 * pooled: three batches after the transport's own archive anchor) and no code-hash comparison, which a fake node cannot meet.
 */
export async function pinsLikeProduction(call: TokenRpcCall, tag: Hex): Promise<void> {
  const code = (address: string): TokenRpcItem => ({ method: "eth_getCode", params: [address, tag], cachePolicy: "immutable", decoder: (v) => v });
  const usdt = (selector: string): TokenRpcItem => ({ method: "eth_call", params: [{ to: ETHEREUM_USDT, data: selector }, tag], cachePolicy: "immutable", decoder: (v) => v });
  const storage: TokenRpcItem = { method: "eth_getStorageAt", params: [UNISWAP_USDC, USDC_IMPLEMENTATION_SLOT, tag], cachePolicy: "immutable", decoder: (v) => v };
  const [deprecated, basisPoints, maximumFee] = [usdt("0x0e136b19"), usdt("0xdd644f72"), usdt("0x35390714")];
  const batches: TokenRpcItem[][] = call.primaryPoolEnabled?.() === true
    ? [[code(UNISWAP_V3_SWAP_ROUTER), code(UNISWAP_V3_USDC_USDT_100), code(UNISWAP_USDC)], [code(ETHEREUM_USDT), storage, code(USDC_IMPLEMENTATION_PIN.address)],
      [deprecated, basisPoints, maximumFee]]
    : [[{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: (v) => v }, code(UNISWAP_V3_SWAP_ROUTER), code(UNISWAP_V3_USDC_USDT_100)],
      [code(UNISWAP_USDC), code(ETHEREUM_USDT), storage], [code(USDC_IMPLEMENTATION_PIN.address), deprecated, basisPoints], [maximumFee]];
  for (const batch of batches) await tokenBatch(call, "archive", batch);
}

/** Writes a captured state file exactly where APN keeps it (an asset-usage ledger row the test did not create through APN). */
export class CapturedState extends SecureStateStore {
  async put(directory: string, file: string, value: unknown): Promise<void> {
    await this.initialize(); await this.ensureDirectory(directory); await this.writeJson(`${directory}/${file}`, value, true);
  }
}
export function usageBucket(account: string, token: string): string {
  return `asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson({ account, chain: "eip155:1", asset: { kind: "token", identifier: token } }))}`;
}

/** A foreground terminal that types the consent phrase it is shown. */
export function typingTerminal() {
  let phrase = ""; const screens: string[] = [];
  return { screens, tty: { isTerminal: () => true, openTerminal: async () => ({ fd: 1, write: async (screen: string) => { screens.push(screen);
    phrase = /Type ([a-z0-9-]+) and/u.exec(screen)?.[1] ?? ""; }, read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => undefined }) } };
}
