/** Finds the destination transaction that consumed one CCTP V2 issuer message from block headers and MessageTransmitter
 * logs only: no state is read at any block (P1). The result is a hint; external adoption proves it from the canonical
 * receipt at the destination SAFE head. */
import { encodeEventTopics, type Hex } from "viem";
import { CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { CIRCLE_ABI, circleFail, circleHex, circleRecord, circleUint } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";

/** Read plan of one discovery (P4): chain identity, the latest head, at most `locate` headers to find the block stamped at
 * the burn time, and at most `logs` transmitter log windows of the route's `logRange` blocks. Every read may be retried
 * once after a transient HTTP failure, so the discovery client's budget is twice the plan. */
export const CIRCLE_DISCOVERY_READ_PLAN = { identity: 1, head: 1, locate: 32, logs: 64 } as const;
export const CIRCLE_DISCOVERY_REQUEST_BUDGET = 2 * (CIRCLE_DISCOVERY_READ_PLAN.identity + CIRCLE_DISCOVERY_READ_PLAN.head +
  CIRCLE_DISCOVERY_READ_PLAN.locate + CIRCLE_DISCOVERY_READ_PLAN.logs);
/** Each chain stamps blocks with its own clock: the scan starts this many seconds before the burn's source timestamp. */
export const CIRCLE_DISCOVERY_CLOCK_MARGIN_S = 60n;
const MESSAGE_RECEIVED = encodeEventTopics({ abi: CIRCLE_ABI, eventName: "MessageReceived" })[0];
export type CircleDiscoveryRpc = Pick<CircleRpc, "chainId" | "identity" | "block" | "call">;
export interface CircleExternalMintScan { readonly transactionHash: Hex | null; readonly fromBlock: bigint; readonly toBlock: bigint;
  readonly headBlock: bigint; readonly headerReads: number; readonly logReads: number; }
interface Header { readonly number: bigint; readonly time: bigint; }
const quantity = (n: bigint) => `0x${n.toString(16)}`;

/** Scans forward from the block stamped at the burn time (less the clock margin) to the latest head, one `logRange`
 * window per request, for the MessageReceived log carrying this nonce, and stops at the first window that has it or
 * after `logs` windows. `transactionHash` is null when the scan ended without it. */
export async function discoverCircleExternalMint(rpc: CircleDiscoveryRpc, nonce: Hex, burnTimestamp: bigint): Promise<CircleExternalMintScan> {
  const range = BigInt(circleRoute(rpc.chainId as CircleDestinationChain).logRange), word = circleHex(nonce, 32);
  let headerReads = 0, logReads = 0, transactionHash: Hex | null = null;
  const read = async (tag: string): Promise<Header> => { headerReads++; const b = await rpc.block(tag); return { number: circleUint(b.number), time: circleUint(b.timestamp) }; };
  await rpc.identity();
  const head = await read("latest"), start = await locate(n => read(quantity(n)), head, burnTimestamp - CIRCLE_DISCOVERY_CLOCK_MARGIN_S, range);
  let from = start, scanned = start;
  while (transactionHash === null && from <= head.number && logReads < CIRCLE_DISCOVERY_READ_PLAN.logs) {
    const to = from + range - 1n < head.number ? from + range - 1n : head.number;
    const logs = await rpc.call("eth_getLogs", [{ address: CIRCLE_TRANSMITTER, topics: [MESSAGE_RECEIVED, null, word], fromBlock: quantity(from), toBlock: quantity(to) }]);
    logReads++; transactionHash = consumer(logs, word, from, to); scanned = to; from = to + 1n;
  }
  return { transactionHash, fromBlock: start, toBlock: scanned, headBlock: head.number, headerReads, logReads };
}

/** A block stamped at or before `target`, at most about one log window early. It is bracketed back from the head (each
 * probe jumps the distance the recent block rate predicts plus one window, and at least doubles), then narrowed by
 * interpolation with a probe one window above every new lower bound. Headers only and at most `locate` reads: when they
 * run out during narrowing, the lower bound found so far is a valid, earlier start. */
async function locate(read: (n: bigint) => Promise<Header>, head: Header, target: bigint, range: bigint): Promise<bigint> {
  if (head.time <= target) return head.number;
  let reads = 0, hi = head, lo: Header | null = null, step = range;
  const probe = async (n: bigint, below: Header | null, above: Header) => {
    reads++; const h = await read(n);
    if (h.number !== n || h.time > above.time || below !== null && h.time < below.time) circleFail("discovery_header_order");
    return h;
  };
  while (lo === null) {
    if (reads >= CIRCLE_DISCOVERY_READ_PLAN.locate) circleFail("discovery_locate_budget");
    const n = hi.number > step ? hi.number - step : 0n, p = await probe(n, null, hi);
    if (p.time <= target || n === 0n) { lo = p; break; }
    const back = hi.time > p.time ? (p.time - target) * (hi.number - p.number) / (hi.time - p.time) : step;
    hi = p; step = back + range > 2n * step ? back + range : 2n * step;
  }
  if (lo.time > target) return lo.number;
  while (hi.number - lo.number > range && reads < CIRCLE_DISCOVERY_READ_PLAN.locate) {
    const width = hi.number - lo.number, guess = hi.time > lo.time ? lo.number + (target - lo.time) * width / (hi.time - lo.time) : lo.number + width / 2n;
    const p = await probe(guess <= lo.number ? lo.number + 1n : guess >= hi.number ? hi.number - 1n : guess, lo, hi);
    if (p.time > target) { hi = p; continue; }
    lo = p; if (hi.number - lo.number <= range || reads >= CIRCLE_DISCOVERY_READ_PLAN.locate) break;
    const next = await probe(lo.number + range, lo, hi); if (next.time > target) hi = next; else lo = next;
  }
  return lo.number;
}

/** The transaction of the one canonical MessageReceived log for this nonce in the window, or null when there is none. A
 * nonce is consumed once, so two logs, or a log outside the filter or the window, fail closed. */
function consumer(value: unknown, nonce: Hex, from: bigint, to: bigint): Hex | null {
  if (!Array.isArray(value) || value.length > 16) circleFail("discovery_logs_shape");
  const hits = value.map(circleRecord).filter(l => l.removed !== true).map(l => {
    if (typeof l.address !== "string" || l.address.toLowerCase() !== CIRCLE_TRANSMITTER.toLowerCase() || !Array.isArray(l.topics) || l.topics.length !== 4 ||
      circleHex(l.topics[0], 32) !== MESSAGE_RECEIVED || circleHex(l.topics[2], 32) !== nonce) circleFail("discovery_log_filter");
    const block = circleUint(l.blockNumber); if (block < from || block > to) circleFail("discovery_log_window");
    return circleHex(l.transactionHash, 32);
  });
  if (hits.length > 1) circleFail("discovery_nonce_consumed_twice");
  return hits[0] ?? null;
}
