import { getBase58Decoder } from "@solana/kit";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import type { SolanaMethod, SolanaRpcPort } from "../../src/solana/rpc.js";
import { TRON_GENESIS } from "../../src/tron/codec.js";
import type { TronMethod, TronRpcPort } from "../../src/tron/rpc.js";
import { buildTronTransaction } from "../../src/tron/transaction.js";

/** Synthetic solidified TRON and finalized Solana responses shaped like the public node APIs (lossless integers). */
export const HOT = "TX5XiRXdyz7sdFwF5mnhT1QoGCpbkncpke", TRON_RECIPIENT = "TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS";
export const SOL_RECIPIENT = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki", SOLVER = "So11111111111111111111111111111111111111112";
export const blockTime = Date.parse("2026-09-18T05:02:00.000Z"), quoteTime = Date.parse("2026-09-18T05:00:00.000Z");
export const lossless = (value: unknown): unknown => parseJsonWithBigInts(JSON.stringify(value));
export function transfer(amount: string, recipient = TRON_RECIPIENT, token = false, time = blockTime) {
  const unsigned = buildTronTransaction({ token, sender: HOT, recipient, amountAtomic: amount, blockId: `0000000005255a3b${"cd".repeat(24)}`,
    timestamp: String(time - 10_000), expiration: String(time + 60_000), energyFeeLimitAtomic: token ? "150000000" : "0" });
  return { ...unsigned, signature: ["ab".repeat(65)], ret: [{ contractRet: "SUCCESS" }] };
}
export const tronBlock = (number: number, timestamp: number, transactions: unknown[]) => ({
  blockID: `${number.toString(16).padStart(16, "0")}${"ef".repeat(24)}`, block_header: { raw_data: { number, timestamp, parentHash: "00".repeat(32) } }, transactions });
export class FakeTron implements TronRpcPort {
  readonly originHash = "fake-tron";
  readonly calls: string[] = [];
  constructor(readonly responses: Map<string, unknown>) {}
  async call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push(method);
    const key = method === "wallet/getblockbynum" ? "genesis" : method === "walletsolidity/getblockbynum" ? `block:${String(body.num)}`
      : method === "walletsolidity/getnowblock" ? "head" : `${method}:${String(body.value)}`;
    if (!this.responses.has(key)) throw new ApnError("APN_RPC_PROTOCOL", `unexpected ${key}`);
    return lossless(this.responses.get(key));
  }
}
export function tronWorld(tx: ReturnType<typeof transfer>, info: Record<string, unknown> = {}, members?: unknown[], time = blockTime) {
  return new FakeTron(new Map<string, unknown>([
    ["genesis", { blockID: TRON_GENESIS, block_header: { raw_data: { timestamp: 0 } } }],
    [`walletsolidity/gettransactionbyid:${tx.txID}`, tx],
    [`walletsolidity/gettransactioninfobyid:${tx.txID}`, { id: tx.txID, blockNumber: 86344166, blockTimeStamp: time, contractResult: [""], receipt: { net_usage: 269 }, ...info }],
    ["block:86344166", tronBlock(86344166, time, members ?? [tx])],
    ["head", tronBlock(86344190, time + 72_000, [])],
  ]));
}
export const SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(7));
export class FakeSolana implements SolanaRpcPort {
  readonly originHash = "fake-solana";
  constructor(readonly responses: Map<SolanaMethod, unknown>) {}
  async call(method: SolanaMethod): Promise<unknown> {
    if (!this.responses.has(method)) throw new ApnError("APN_RPC_PROTOCOL", `unexpected ${method}`);
    return lossless(this.responses.get(method));
  }
}
export function solanaWorld(credit: number, changes: { status?: Record<string, unknown> | null; meta?: Record<string, unknown>; keys?: string[]; v0?: boolean } = {}, time = blockTime) {
  const keys = changes.keys ?? [SOLVER, SOL_RECIPIENT, "11111111111111111111111111111111"];
  return new FakeSolana(new Map<SolanaMethod, unknown>([
    ["getGenesisHash", SOLANA_GENESIS],
    ["getSignatureStatuses", { context: { slot: 400 }, value: [changes.status === null ? null
      : { slot: 390, confirmations: null, err: null, confirmationStatus: "finalized", ...changes.status }] }],
    ["getTransaction", { slot: 390, blockTime: Math.floor(time / 1000), meta: { err: null, fee: 5000,
      preBalances: [5_000_000_000, 1_900_000, 1], postBalances: [5_000_000_000 - credit - 5000, 1_900_000 + credit, 1],
      ...(changes.v0 ? { loadedAddresses: { writable: [], readonly: [] } } : {}), ...changes.meta },
    ...(changes.v0 ? { version: 0 } : {}),
    transaction: { signatures: [SIGNATURE], message: { accountKeys: keys, recentBlockhash: SOLVER, instructions: [],
      ...(changes.v0 ? { addressTableLookups: [] } : {}) } } }],
  ]));
}

