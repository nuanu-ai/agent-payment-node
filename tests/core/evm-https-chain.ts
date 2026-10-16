import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { getAddress, keccak256, pad, parseTransaction, toHex } from "viem";
import { TRANSFER_TOPIC } from "./evm-helpers.js";

/** A synthetic EVM node behind the production HTTPS transport: it answers single and batched JSON-RPC and records each POST. */
export interface EvmHttpsChain {
  readonly posts: string[][];
  readonly sends: `0x${string}`[];
  chainId: number;
  receipts: boolean;
  safeLag: boolean;
  status: number;
  nonceFinalized: bigint;
}

const HEAD = 12345n, INCLUDED = 12340n;
const hashOf = (number: bigint) => `0x${number.toString(16).padStart(64, "b")}`;
const word = (value: bigint) => toHex(value, { size: 32 });

export function mockEvmHttps(t: TestContext, chainId: number, wallet: () => string): EvmHttpsChain {
  const chain: EvmHttpsChain = { posts: [], sends: [], chainId, receipts: true, safeLag: false, status: 200, nonceFinalized: 7n };
  const block = (tag: string) => {
    const number = tag === "latest" || tag === "finalized" ? HEAD : tag === "safe" ? (chain.safeLag ? INCLUDED - 1n : HEAD) : BigInt(tag);
    return { number: toHex(number), hash: hashOf(number), baseFeePerGas: toHex(1_000_000_000n), timestamp: toHex(1_700_000_000n), transactions: [] };
  };
  const answer = (method: string, params: readonly unknown[]): unknown => {
    const sent = chain.sends.at(-1);
    switch (method) {
      case "eth_chainId": return toHex(chain.chainId);
      case "eth_getBlockByNumber": return block(params[0] as string);
      case "eth_getBalance": return toHex(10n ** 19n);
      case "eth_getCode": return "0x6000";
      case "eth_call": {
        const call = params[0] as { to: string; data: string };
        if (call.to.toLowerCase() === "0x420000000000000000000000000000000000000f") return word(1000n);
        return call.data === "0x313ce567" ? word(6n) : word(10n ** 12n);
      }
      case "eth_getTransactionCount": return params[1] === "finalized" ? toHex(chain.nonceFinalized) : "0x7";
      case "eth_estimateGas": return toHex((params[0] as { data: string }).data === "0x" ? 21_000n : 65_000n);
      case "eth_maxPriorityFeePerGas": return toHex(1_000_000_000n);
      case "eth_sendRawTransaction": chain.sends.push(params[0] as `0x${string}`); return keccak256(params[0] as `0x${string}`);
      case "eth_getTransactionReceipt": case "eth_getTransactionByHash": {
        if (sent === undefined || (method === "eth_getTransactionReceipt" && !chain.receipts)) return null;
        const tx = parseTransaction(sent), hash = keccak256(sent), data = tx.data ?? "0x";
        if (method === "eth_getTransactionByHash") return { hash, blockHash: hashOf(INCLUDED), blockNumber: toHex(INCLUDED), chainId: toHex(chain.chainId),
          from: wallet(), to: tx.to, value: toHex(tx.value ?? 0n), input: data, type: "0x2", gas: toHex(tx.gas ?? 0n), maxFeePerGas: toHex(tx.maxFeePerGas ?? 0n),
          maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas ?? 0n), accessList: [], nonce: toHex(tx.nonce ?? 0) };
        const logs = data === "0x" ? [] : [{ address: getAddress(tx.to!), topics: [TRANSFER_TOPIC, pad(wallet() as `0x${string}`, { size: 32 }),
          pad(`0x${data.slice(34, 74)}`, { size: 32 })], data: word(BigInt(`0x${data.slice(-64)}`)), transactionHash: hash,
          blockHash: hashOf(INCLUDED), blockNumber: toHex(INCLUDED), logIndex: "0x0", transactionIndex: "0x0", removed: false }];
        return { transactionHash: hash, blockHash: hashOf(INCLUDED), blockNumber: toHex(INCLUDED), status: "0x1", logs };
      }
      default: throw new Error(`unexpected ${method}`);
    }
  };
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
      const items = Array.isArray(envelope) ? envelope : [envelope];
      chain.posts.push(items.map(item => item.method));
      const replies = chain.status !== 200 ? [] : items.map(item => ({ jsonrpc: "2.0", id: item.id, result: answer(item.method, item.params) }));
      const raw = chain.status !== 200 ? "" : JSON.stringify(Array.isArray(envelope) ? replies.reverse() : replies[0]);
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = chain.status;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); }; receive(response);
        if (chain.status === 200) response.emit("data", Buffer.from(raw));
        response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return chain;
}
