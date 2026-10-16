import { keccak256 } from "viem";
import { hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { Hex } from "../../model.js";
import type { MetaMaskGaslessBlock, MetaMaskGaslessCursor, MetaMaskGaslessDeploymentRow, MetaMaskGaslessIntent } from "../model.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { addressWord, callData, MM_INCREASED_COUNT_TOPIC, quantity, recheckBlock, rpcBlock, rpcHex, rpcRecord, rpcWord,
  type MmRpcCall } from "./abi.js";
import { mmEvidenceFail } from "./diagnostic.js";
import { verifyScanLog } from "./receipt.js";

/** Widest log window asked for; narrower windows are only used after the RPC refuses one. */
export const MM_SCAN_WINDOW = 2000n;
/** Narrowest window worth asking for; a refusal at this width is reported, never narrowed further. */
export const MM_MIN_SCAN_WINDOW = 50n;
/** eth_getLogs requests one resume may spend, refused ones included. Unscanned blocks wait for the next resume. */
export const MM_MAX_LOG_QUERIES = 8;
const MAX_SCAN_LOGS = 512;
const MAX_SCAN_CANDIDATES = 8;

/** Transport and log-limit reasons that keep the progress already proved in this resume. */
export const MM_SCAN_STOP_REASONS: readonly MetaMaskGaslessFailureReason[] =
  ["mm_gasless_rpc_unavailable", "mm_gasless_rpc_log_range", "mm_gasless_rpc_rate_limited"];

export interface MetaMaskScanContext {
  readonly row: MetaMaskGaslessDeploymentRow;
  readonly call: MmRpcCall;
}

export type MetaMaskScanResult =
  /** No redemption is possible up to `cursor`; the scan may still have unscanned blocks before finality. */
  | { readonly kind: "progress"; readonly cursor: MetaMaskGaslessCursor; readonly evidenceHash: string }
  /** The RPC stopped answering after `cursor`, which only covers fully verified blocks. */
  | { readonly kind: "stopped"; readonly cursor: MetaMaskGaslessCursor; readonly reason: MetaMaskGaslessFailureReason }
  /** Counter logs inside the window that starts at `cursor`; the caller inspects them and then rechecks `recheck`. */
  | { readonly kind: "found"; readonly cursor: MetaMaskGaslessCursor; readonly candidates: readonly Hex[];
      readonly recheck: readonly MetaMaskGaslessBlock[]; readonly evidenceHash: string };

/**
 * Locate a redemption of the delegation after the cursor, up to the registry finality block.
 *
 * Counter shortcut. `LimitedCallsEnforcer.callCounts(manager, delegationHash)` is written in exactly one place, its
 * `beforeHook`, as `++callCounts[msg.sender][delegationHash]` followed by a `limit` check and the `IncreasedCount`
 * event. The pinned DelegationManager calls that hook only inside `redeemDelegations`, after it has authenticated
 * the delegation whose hash it passes, so the slot keyed by the pinned manager and this exact delegation hash counts
 * this delegation's redemptions and nothing else; a call from anyone else lands in that caller's own slot. A
 * redemption that reverts anywhere, the transfers included, rolls the increment back with the rest of the
 * transaction. The count never decreases, and the prepare snapshot proved it was 0 at the frozen safe block that
 * starts the cursor. Read at a canonical block pinned by hash, against the pinned enforcer code, a count of 0 therefore
 * proves that no successful redemption exists in any block up to it, so the cursor may move there without a log
 * query. A reverted attempt leaves neither the increment nor its event, so the log scan never saw one either; a
 * revert is still only learnt from the provider's transaction hash. With limit 1 the count can only be 0 or 1.
 * Once it is 1, the bounded log scan finds the redeeming transaction for full inspection.
 */
export async function scanMetaMaskRedemption(context: MetaMaskScanContext, intent: MetaMaskGaslessIntent,
  cursor: MetaMaskGaslessCursor): Promise<MetaMaskScanResult> {
  const { call, row } = context;
  await recheckBlock(call, cursor.startBlock);
  if (cursor.previousEndBlock !== null) await recheckBlock(call, cursor.previousEndBlock);
  const finality = (await rpcBlock(call, row.finalityTag)).block;
  const start = BigInt(cursor.nextBlockAtomic), last = BigInt(finality.numberAtomic);
  if (last < start) {
    await recheckBlock(call, finality);
    return { kind: "progress", cursor, evidenceHash: hashObject({ cursor, finality, empty: true }) };
  }
  const counter = await mmRedemptionCount(context, intent.delegationHash, finality);
  await recheckBlock(call, finality);
  if (counter === 0n) {
    return { kind: "progress", cursor: { startBlock: cursor.startBlock, nextBlockAtomic: (last + 1n).toString(),
      previousEndBlock: finality }, evidenceHash: hashObject({ purpose: "apn.metamask-gasless.counter-scan.v1",
      cursor, finality, delegationHash: intent.delegationHash, counterAtomic: "0" }) };
  }
  return await scanLogs(context, intent, cursor, finality);
}

/** `callCounts(manager, delegationHash)` at one canonical block pinned by hash, against the pinned enforcer code. */
export async function mmRedemptionCount(context: MetaMaskScanContext, delegationHash: Hex, at: MetaMaskGaslessBlock): Promise<bigint> {
  const pinned = { blockHash: at.hash, requireCanonical: true } as const, enforcer = context.row.protocol.limitedCalls;
  const [code, count] = await Promise.all([
    context.call("eth_getCode", [enforcer.address, pinned]).then(value => rpcHex(value, 256 * 1024)),
    context.call("eth_call", [{ to: enforcer.address, data: callData("callCounts(address,bytes32)",
      [addressWord(context.row.protocol.manager.address), delegationHash]) }, pinned]).then(value => rpcWord(value)),
  ]);
  if (code === "0x" || keccak256(code) !== enforcer.codeHash) mmEvidenceFail("mm_gasless_evidence_invalid", "protocol_code_pin", "eth_getCode");
  if (count > 1n) mmEvidenceFail("mm_gasless_evidence_invalid", "counter", "eth_call");
  return count;
}

/**
 * Bounded windows from the cursor towards finality. A window the RPC refuses as too wide (or rate-limits) is halved
 * and asked again, down to the minimum width; every request counts against the per-resume budget. Each window's end
 * header is read before its logs and rechecked after them, so a window is only passed once it is proved empty.
 */
async function scanLogs(context: MetaMaskScanContext, intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor,
  finality: MetaMaskGaslessBlock): Promise<MetaMaskScanResult> {
  const { call, row } = context, last = BigInt(finality.numberAtomic);
  let current = cursor, window = MM_SCAN_WINDOW, queries = 0;
  const scanned: Array<{ readonly from: string; readonly to: string; readonly end: MetaMaskGaslessBlock }> = [];
  try {
    while (BigInt(current.nextBlockAtomic) <= last && queries < MM_MAX_LOG_QUERIES) {
      const from = BigInt(current.nextBlockAtomic), to = minimum(last, from + window - 1n);
      const end = (await rpcBlock(call, quantity(to))).block;
      queries += 1;
      let rawLogs: unknown;
      try {
        rawLogs = await call("eth_getLogs", [{ address: row.protocol.limitedCalls.address, fromBlock: quantity(from),
          toBlock: quantity(to), topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address), null,
            intent.delegationHash] }]);
      } catch (error) {
        const reason = limitReason(error);
        if (reason === null) throw error;
        if (window / 2n < MM_MIN_SCAN_WINDOW) return { kind: "stopped", cursor: current, reason };
        window /= 2n;
        continue;
      }
      if (!Array.isArray(rawLogs) || rawLogs.length > MAX_SCAN_LOGS) mmFail("mm_gasless_evidence_invalid");
      const candidates = new Set<Hex>();
      for (const raw of rawLogs) candidates.add(verifyScanLog(rpcRecord(raw), intent, from, to));
      if (candidates.size > MAX_SCAN_CANDIDATES) mmFail("mm_gasless_evidence_invalid");
      if (candidates.size > 0) {
        return { kind: "found", cursor: current, candidates: [...candidates], recheck: [end, finality],
          evidenceHash: hashObject({ cursor: current, from: from.toString(), to: to.toString(), end, finality }) };
      }
      await recheckBlock(call, end);
      scanned.push({ from: from.toString(), to: to.toString(), end });
      current = { startBlock: cursor.startBlock, nextBlockAtomic: (to + 1n).toString(), previousEndBlock: end };
    }
  } catch (error) {
    const reason = stopReason(error);
    if (reason === null || current === cursor) throw error;
    return { kind: "stopped", cursor: current, reason };
  }
  await recheckBlock(call, finality);
  // The counter proved a redemption no later than finality, and every block before the cursor is proved free of
  // one. Reaching finality without its event means the RPC's answers contradict each other.
  if (BigInt(current.nextBlockAtomic) > last) mmEvidenceFail("mm_gasless_evidence_invalid", "counter", "eth_getLogs");
  return { kind: "progress", cursor: current, evidenceHash: hashObject({ purpose: "apn.metamask-gasless.log-scan.v1",
    cursor, finality, scanned, counterAtomic: "1" }) };
}

function stopReason(error: unknown): MetaMaskGaslessFailureReason | null {
  if (!(error instanceof ApnError) || typeof error.details?.reason !== "string") return null;
  const reason = error.details.reason as MetaMaskGaslessFailureReason;
  return MM_SCAN_STOP_REASONS.includes(reason) ? reason : null;
}

function limitReason(error: unknown): "mm_gasless_rpc_log_range" | "mm_gasless_rpc_rate_limited" | null {
  const reason = stopReason(error);
  return reason === "mm_gasless_rpc_log_range" || reason === "mm_gasless_rpc_rate_limited" ? reason : null;
}

function minimum(left: bigint, right: bigint): bigint { return left < right ? left : right; }
