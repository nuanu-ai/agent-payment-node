import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, numberToHex, padHex, toEventSelector, type Hex } from "viem";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { UsdtBoundOperationRepository } from "../../src/gasless-usdt/bound-operation.js";
import { UsdtExecutionJournal, usdtExecutionIntent } from "../../src/gasless-usdt/execution-journal.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { preparePolicyBoundUsdtV2 } from "../../src/gasless-usdt/policy-prepare-v2.js";
import { decodeUsdtPaymasterData } from "../../src/gasless-usdt/paymaster-data.js";
import { verifyUsdtReceipt, type UsdtChainReceipt } from "../../src/gasless-usdt/receipt.js";
import { restoreUsdtPlan } from "../../src/gasless-usdt/restored-plan.js";
import { UsdtRecoveryService, usdtRecordPins, type UsdtRecoveryPort, type UsdtUserOperationScan } from "../../src/gasless-usdt/recovery.js";
import { scanUsdtUserOperation } from "../../src/gasless-usdt/rpc-scan.js";
import { temporaryState } from "./helpers.js";
import { v2Fixture, V2_NOW, V2_OWNER, V2_RECIPIENT } from "./gasless-usdt-v2-fixture.js";

const HASH = `0x${"ab".repeat(32)}` as Hex, TX = `0x${"cc".repeat(32)}` as Hex, OTHER_TX = `0x${"dd".repeat(32)}` as Hex;
const EVENT = toEventSelector("UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const TRANSFER = toEventSelector("Transfer(address indexed from, address indexed to, uint256 value)");
const VALID_UNTIL = BigInt(V2_NOW.getTime() / 1000) + 300n;
const AFTER_VALIDITY = new Date((Number(VALID_UNTIL) + 100) * 1000);
const identity = { account: V2_OWNER, chain: USDT_GASLESS.chain, asset: { kind: "token" as const, identifier: USDT_GASLESS.token } };

function receipt(hash: Hex, success: boolean, transactionHash = TX): UsdtChainReceipt {
  const logs = [{ address: USDT_GASLESS.entryPoint, topics: [EVENT, hash, padHex(V2_OWNER, { size: 32 }), padHex(USDT_GASLESS.paymaster, { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [7n, success, 10n, 20n]) }];
  if (success) for (const [to, amount] of [[V2_RECIPIENT, 1n], [USDT_GASLESS.treasury, 100n]] as const) {
    logs.push({ address: USDT_GASLESS.token, topics: [TRANSFER, padHex(V2_OWNER, { size: 32 }), padHex(to, { size: 32 })],
      data: padHex(numberToHex(amount), { size: 32 }) });
  }
  return { transactionHash, blockNumber: 26_003_000n, status: "success", logs };
}
const pending: UsdtUserOperationScan = { status: "not_found", final: false, finalizedBlock: 26_002_990n, endBlock: 26_002_990n, endBlockHash: null };
const expired: UsdtUserOperationScan = { status: "not_found", final: true, finalizedBlock: 26_010_000n, endBlock: 26_002_976n,
  endBlockHash: `0x${"ee".repeat(32)}` };

async function submitted(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = v2Fixture("expected");
  const prepared = await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor }, f.request);
  const bound = await new UsdtBoundOperationRepository(temporary.root).create(allowlistProfileHash("owner"), prepared, "scan-001", f.now());
  const journal = new UsdtExecutionJournal(temporary.root);
  await journal.reserve(bound, usdtExecutionIntent(bound), f.prepare);
  await journal.markSubmitting(bound, f.prepare, HASH);
  const ledger = new AssetUsageLedger(temporary.root);
  return { bound, journal, ledger };
}
function port(scan: () => Promise<UsdtUserOperationScan>, receipts: Readonly<Record<string, UsdtChainReceipt | null>>,
  locator: UsdtRecoveryPort["userOperationReceipt"] = async () => null): UsdtRecoveryPort & { scans: unknown[] } {
  const scans: unknown[] = [];
  return { scans, userOperationReceipt: locator, canonicalFinalizedReceipt: async hash => receipts[hash] ?? null,
    scanUserOperation: async input => { scans.push(input); return await scan(); } };
}

test("receipt proofs of a saved operation use the pins stored in its record, not today's constants", async t => {
  const s = await submitted(t), b = s.bound.binding, pins = usdtRecordPins(s.bound);
  assert.deepEqual(pins, { token: b.token, paymaster: b.unsignedOperation.paymaster,
    treasury: decodeUsdtPaymasterData(b.paymasterData).treasury, entryPoint: USDT_GASLESS.entryPoint });
  // A later release that moved the paymaster or treasury must still close an operation sent under the earlier pair.
  const moved = { ...pins, paymaster: "0x1111111111111111111111111111111111111111" as const,
    treasury: "0x2222222222222222222222222222222222222222" as const };
  const sent = receipt(HASH, true), rewrite = (address: string) =>
    address.toLowerCase() === USDT_GASLESS.paymaster.toLowerCase() ? moved.paymaster : address.toLowerCase() === USDT_GASLESS.treasury.toLowerCase() ? moved.treasury : address;
  const underOldPins: UsdtChainReceipt = { ...sent, logs: sent.logs.map(log => ({ ...log,
    topics: log.topics.map(topic => /^0x0{24}/u.test(topic) ? padHex(rewrite(`0x${topic.slice(26)}`) as Hex, { size: 32 }) : topic) })) };
  const plan = restoreUsdtPlan(s.bound);
  assert.equal(verifyUsdtReceipt(plan, HASH, underOldPins, moved).recipientCreditAtomic, plan.netAtomic.toString());
  assert.throws(() => verifyUsdtReceipt(plan, HASH, underOldPins, pins), /receipt_paymaster|receipt_transfers/u);
});

test("a missing bundler locator falls back to the canonical EntryPoint scan and settles from the chain receipt", async t => {
  for (const success of [true, false]) {
    const s = await submitted(t);
    const recovery = port(async () => ({ status: "found", transactionHash: TX }), { [TX]: receipt(HASH, success) },
      async () => { throw new Error("locator rate limited"); });
    const result = await new UsdtRecoveryService(s.journal, recovery, () => V2_NOW).observe(s.bound);
    assert.equal(result.state, success ? "finalized" : "failed_confirmed_revert");
    assert.deepEqual(recovery.scans, [{ userOpHash: HASH, sender: V2_OWNER, fromBlock: 26_002_950n,
      fromBlockHash: `0x${"12".repeat(32)}`, validUntil: VALID_UNTIL, paymaster: USDT_GASLESS.paymaster, entryPoint: USDT_GASLESS.entryPoint }]);
    assert.equal((await s.ledger.load(identity, result.reservationId))?.state, result.state);
  }
});

test("a finalized locator receipt without this operation's event does not decide; the canonical scan does", async t => {
  const s = await submitted(t);
  const recovery = port(async () => ({ status: "found", transactionHash: OTHER_TX }),
    { [TX]: receipt(`0x${"bb".repeat(32)}`, true), [OTHER_TX]: receipt(HASH, true, OTHER_TX) },
    async () => ({ userOpHash: HASH, sender: V2_OWNER, entryPoint: USDT_GASLESS.entryPoint, paymaster: USDT_GASLESS.paymaster,
      success: true, transactionHash: TX }));
  const result = await new UsdtRecoveryService(s.journal, recovery, () => V2_NOW).observe(s.bound);
  assert.equal(result.state, "finalized"); assert.equal(result.settlement?.transactionHash, OTHER_TX);
});

test("a proven never-landed operation is terminal and releases its usage lease exactly once", async t => {
  const s = await submitted(t);
  let scan = pending;
  const recovery = port(async () => scan, {});
  const service = new UsdtRecoveryService(s.journal, recovery, () => AFTER_VALIDITY);
  const unknown = await service.observe(s.bound);
  assert.equal(unknown.state, "unknown_finality", "an unfinished scan is never negative proof");
  assert.equal((await s.ledger.load(identity, unknown.reservationId))?.state, "unknown_finality");
  scan = expired;
  const closed = await service.observe(s.bound);
  assert.equal(closed.state, "expired_never_landed"); assert.equal(closed.settlement, null);
  const lease = await s.ledger.load(identity, closed.reservationId);
  assert.equal(lease?.state, "released_unsubmitted"); assert.equal(lease?.outcomeDigest, closed.outcomeDigest);
  assert.equal((await s.ledger.usage(identity, AFTER_VALIDITY)).amountAtomic, "0");
  assert.deepEqual(await service.observe(s.bound), closed); assert.equal(recovery.scans.length, 2);
  assert.deepEqual(await s.journal.load(s.bound.operationId), closed);
});

test("a never-landed proof is refused while the local clock still admits the paymaster signature", async t => {
  const s = await submitted(t);
  await assert.rejects(new UsdtRecoveryService(s.journal, port(async () => expired, {}), () => V2_NOW).observe(s.bound),
    /paymaster_still_valid/u);
  assert.equal((await s.journal.load(s.bound.operationId))?.state, "submitting");
});

function scanPeer(blocks: Readonly<Record<string, { number: bigint; hash: Hex; timestamp: bigint }>>, logs: (from: bigint, to: bigint) => unknown[]) {
  const batches: { method: string; params: unknown[] }[][] = [];
  return { batches, batch: async (calls: readonly { method: string; params: readonly unknown[] }[]) => {
    batches.push(calls as { method: string; params: unknown[] }[]);
    return calls.map(call => {
      if (call.method === "eth_chainId") return "0x1";
      if (call.method === "eth_getLogs") {
        const filter = call.params[0] as { fromBlock: Hex; toBlock: Hex };
        return logs(BigInt(filter.fromBlock), BigInt(filter.toBlock));
      }
      const key = String(call.params[0]), block = blocks[key] ?? blocks[BigInt(key).toString()];
      if (block === undefined) throw new Error(`unscripted block ${key}`);
      return { number: numberToHex(block.number), hash: block.hash, timestamp: numberToHex(block.timestamp) };
    });
  } };
}

test("the canonical scan is bounded by validUntil, batched in public-RPC windows and proves absence only when final", async () => {
  const anchor = { number: 1_000n, hash: `0x${"12".repeat(32)}` as Hex, timestamp: 1_000_000n };
  const input = { userOpHash: HASH, sender: V2_OWNER, fromBlock: 1_000n, fromBlockHash: anchor.hash, validUntil: 1_003_600n,
    paymaster: USDT_GASLESS.paymaster, entryPoint: USDT_GASLESS.entryPoint };
  const blocks = { finalized: { number: 9_000n, hash: `0x${"99".repeat(32)}` as Hex, timestamp: 1_100_000n }, "1000": anchor,
    "1301": { number: 1_301n, hash: `0x${"13".repeat(32)}` as Hex, timestamp: 1_003_612n } };
  const empty = scanPeer(blocks, () => []);
  assert.deepEqual(await scanUsdtUserOperation(empty, input), { status: "not_found", final: true, finalizedBlock: 9_000n,
    endBlock: 1_301n, endBlockHash: `0x${"13".repeat(32)}` });
  assert.equal(empty.batches.length, 2);
  assert.deepEqual(empty.batches[1]!.map(call => call.method), ["eth_getLogs", "eth_getLogs", "eth_getLogs", "eth_getLogs", "eth_getBlockByNumber"]);
  assert.deepEqual(empty.batches[1]!.slice(0, 4).map(call => (call.params[0] as { fromBlock: Hex; toBlock: Hex })),
    [["0x3e8", "0x44b"], ["0x44c", "0x4af"], ["0x4b0", "0x513"], ["0x514", "0x515"]].map(([fromBlock, toBlock]) => ({ address: USDT_GASLESS.entryPoint,
      fromBlock, toBlock, topics: [EVENT, HASH, padHex(V2_OWNER.toLowerCase() as Hex, { size: 32 }), padHex(USDT_GASLESS.paymaster.toLowerCase() as Hex, { size: 32 })] })));
  const log = (transactionHash: Hex, blockNumber: bigint) => ({ address: USDT_GASLESS.entryPoint, blockNumber: numberToHex(blockNumber),
    transactionHash, removed: false, topics: [EVENT, HASH, padHex(V2_OWNER.toLowerCase() as Hex, { size: 32 }), padHex(USDT_GASLESS.paymaster.toLowerCase() as Hex, { size: 32 })] });
  assert.deepEqual(await scanUsdtUserOperation(scanPeer(blocks, (from) => from === 1_100n ? [log(TX, 1_150n)] : []), input),
    { status: "found", transactionHash: TX });
  await assert.rejects(scanUsdtUserOperation(scanPeer(blocks, (from) => from === 1_100n ? [log(TX, 1_150n), log(OTHER_TX, 1_160n)] : []), input),
    /gasless_usdt_scan_ambiguous/u);
  await assert.rejects(scanUsdtUserOperation(scanPeer(blocks, (from) => from === 1_100n ? [log(TX, 1_250n)] : []), input),
    /gasless_usdt_scan_log_identity/u);
  await assert.rejects(scanUsdtUserOperation(scanPeer({ ...blocks, "1000": { ...anchor, hash: `0x${"34".repeat(32)}` } }, () => []), input),
    /gasless_usdt_scan_anchor_not_canonical/u);
  const young = { ...blocks, finalized: { number: 1_200n, hash: `0x${"77".repeat(32)}` as Hex, timestamp: 1_002_400n },
    "1200": { number: 1_200n, hash: `0x${"77".repeat(32)}` as Hex, timestamp: 1_002_400n } };
  assert.deepEqual(await scanUsdtUserOperation(scanPeer(young, () => []), input), { status: "not_found", final: false,
    finalizedBlock: 1_200n, endBlock: 1_200n, endBlockHash: `0x${"77".repeat(32)}` });
  const slow = { ...blocks, "1301": { ...blocks["1301"], timestamp: 1_003_600n } };
  assert.equal((await scanUsdtUserOperation(scanPeer(slow, () => []), input) as { final: boolean }).final, false,
    "the last scanned header must itself be after validUntil");
});
