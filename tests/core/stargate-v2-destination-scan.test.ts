/** BRDG-30: bounded, resumable Stargate destination log scans that never dead-end. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { scanStargateLogs, StargateDestinationScanStore, STARGATE_SCAN_WINDOWS_PER_CALL } from "../../src/stargate-v2/destination-scan.js";
import { temporaryState } from "./helpers.js";

const POOL = "0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4", TOPIC = `0x${"ab".repeat(32)}` as Hex;
const log = (block: bigint, index = 1n) => ({ address: POOL, topics: [TOPIC], data: "0x", transactionHash: `0x${"12".repeat(32)}`,
  logIndex: `0x${index.toString(16)}`, blockNumber: `0x${block.toString(16)}`, blockHash: `0x${"34".repeat(32)}` });

test("the scan cursor is durable, operation-bound and only advances over empty windows", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const store = new StargateDestinationScanStore(temp.root), cursor = store.cursor("a".repeat(64), "token-oft");
  assert.equal(await cursor.load(), null);
  const windows: [bigint, bigint][] = [], deliveryBlock = 4_250n;
  const call = async (method: string, params: readonly unknown[]) => {
    assert.equal(method, "eth_getLogs"); const filter = params[0] as { fromBlock: string; toBlock: string; topics: readonly Hex[] };
    assert.deepEqual(filter.topics, [TOPIC]);
    const from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock); windows.push([from, to]);
    return deliveryBlock >= from && deliveryBlock <= to ? [log(deliveryBlock), log(deliveryBlock)] : [];
  };
  assert.deepEqual(await scanStargateLogs(call, { address: POOL as Hex, topics: [TOPIC] }, 1_000n, 10_000n, 100n, cursor), []);
  assert.equal(windows.length, STARGATE_SCAN_WINDOWS_PER_CALL); assert.equal(await cursor.load(), 1_000n + 3_200n);
  // A new store instance (a later command) resumes where the last one stopped and finds the delivery; identical rows collapse.
  const resumed = new StargateDestinationScanStore(temp.root).cursor("a".repeat(64), "token-oft");
  const found = await scanStargateLogs(call, { address: POOL as Hex, topics: [TOPIC] }, 1_000n, 10_000n, 100n, resumed);
  assert.equal(found.length, 1); assert.deepEqual(windows.at(-1), [4_200n, 4_299n]); assert.equal(await resumed.load(), 4_200n);
  assert.equal(await new StargateDestinationScanStore(temp.root).cursor("a".repeat(64), "native-oft").load(), null);
});

test("a conflicting repeated provider row fails closed and a head below the cursor scans nothing", async () => {
  const conflicting = async () => [log(5n), { ...log(5n), data: "0x01" }];
  await assert.rejects(scanStargateLogs(conflicting, { address: POOL as Hex, topics: [TOPIC] }, 1n, 10n, 100n), { code: "APN_RPC_PROTOCOL" });
  let calls = 0; const saved = { load: async () => 50n, save: async () => { throw new Error("must not move the cursor back"); } };
  assert.deepEqual(await scanStargateLogs(async () => { calls++; return []; }, { address: POOL as Hex, topics: [TOPIC] }, 1n, 40n, 100n, saved), []);
  assert.equal(calls, 0);
});
