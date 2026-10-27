import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { attestedFromSource } from "../../src/lifi/circle-v2-cctp-message.js";
import { circleSourceStatus } from "../../src/lifi/circle-v2-source-proof.js";
import { absent, base, burned, copy, deliveryFile, H, iris, reader, recorded, setup, SMALL, sourceBlock, sourceReceipt, status, STATUS,
  type Json } from "./circle-solana-delivery-fixtures.js";

/**
 * QA 0.5.76 (CIRCLE-DELIVERY-SOURCE-BINDING-076-001): Circle's issuer API answered a new burn's hash with the attested
 * message and Solana receipt of an older burn of the same terms, and the new operation became `delivered`. CCTP V2
 * assigns nonces offchain and this route's message names no payer (sender is the fee wrapper, max fee 0, the hook is
 * fixed by the recipient), so two burns of one amount to one token account emit the same bytes. What the chains fix is
 * bound: the attested bytes are the burn's own `MessageSent` in every byte but the attester's fields, and the receive is
 * later than the burn's block. Between such burns in flight together only Circle's nonce tells them apart.
 */
const TRANSMITTER = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64";
const RECEIVED = BigInt(SMALL.receive.blockTime as bigint);
const sent = (receipt: Json) => (receipt.logs as Json[]).find(log => log.address === TRANSMITTER)!;
/** The receipt with its `MessageSent` message changed; the data stays canonical ABI `bytes` unless `data` rewrites it. */
function withEvent(receipt: Json, change: (message: Buffer) => Buffer | void, data?: (hex: string) => string): Json {
  const log = sent(receipt), raw = Buffer.from((log.data as string).slice(2), "hex");
  const original = raw.subarray(64, 64 + Number(BigInt(`0x${raw.subarray(32, 64).toString("hex")}`)));
  const edited = Buffer.from(original), message = change(edited) ?? edited;
  const padded = Buffer.alloc(Math.ceil(message.length / 32) * 32); message.copy(padded);
  const length = Buffer.from(message.length.toString(16).padStart(64, "0"), "hex");
  const hex = `0x${Buffer.concat([raw.subarray(0, 32), length, padded]).toString("hex")}`;
  log.data = data === undefined ? hex : data(hex);
  return receipt;
}
const unread = async (view: Awaited<ReturnType<typeof status>>, reason: string, label: string) => {
  assert.deepEqual([view.phase, view.delivery?.state, view.delivery?.proof, view.nextActions.at(-1)], ["source_finalized", "unread", null, STATUS], label);
  assert.ok(view.delivery?.unreadReason?.endsWith(`(${reason})`), `${label}: ${view.delivery?.unreadReason}`);
};
const claims = (root: string, dir = "circle-solana-delivery-claims-v2") => readFile(join(root, dir, `${(SMALL.iris.messages[0].eventNonce as string).slice(2)}.json`), "utf8");

test("a receipt older than the burn is not its delivery, whatever Circle answers for the burn", async (t) => {
  // The QA case on chain data: a new burn of the same principal to the same account emits the old burn's bytes exactly.
  const { root, journal } = await setup(t), calls: string[] = [];
  const later = await burned(root, SMALL, H("c"), 8); await recorded(root, later);
  const statusOf = (answers = {}, time = RECEIVED + 60n) => status(root, later, reader(SMALL, calls, answers), SMALL, sourceReceipt(SMALL, later), sourceBlock(time));
  for (const time of [RECEIVED + 60n, RECEIVED]) {
    const view = await statusOf({}, time);
    assert.deepEqual([view.phase, view.delivery?.state], ["source_finalized", "unread"]);
    assert.ok(view.delivery?.unreadReason?.endsWith("(circle_delivery_receipt_before_burn)"), view.delivery?.unreadReason);
  }
  // Found through the used-nonce account instead of Circle's forward, the older receive is final too: no resubmission is
  // offered for a message already received.
  const failed = await statusOf({ iris: iris(SMALL, m => { m.forwardState = "FAILED"; m.forwardTxHash = null; }) });
  assert.deepEqual([failed.phase, failed.delivery?.state, failed.nextActions], ["source_finalized", "unread", [`apn operation status --operation ${H("c")}`]]);
  assert.ok(failed.delivery?.unreadReason?.endsWith("(circle_delivery_receipt_before_burn)"), failed.delivery?.unreadReason);
  await assert.rejects(claims(root), { code: "ENOENT" });
  // The older burn's own status still proves its delivery.
  assert.equal((await status(root, journal, reader(SMALL, []))).phase, "delivered");
});

test("between burns of the same bytes in flight together, Circle's nonce decides, and one receipt still proves one operation", async (t) => {
  const { root, journal } = await setup(t);
  const twin = await burned(root, SMALL, H("c"), 8); await recorded(root, twin);
  const view = await status(root, twin, reader(SMALL, []), SMALL, sourceReceipt(SMALL, twin), sourceBlock(SMALL.burnTime + 30n));
  assert.deepEqual([view.phase, view.delivery?.proof?.solanaSignature], ["delivered", SMALL.signature]);
  await unread(await status(root, journal, reader(SMALL, [])), "circle_delivery_message_claimed", "the twin holds the receipt");
});

test("a message that differs from the burn's own event in a byte the burn fixed proves nothing", async (t) => {
  // The QA reproduction's receipt carries no Circle event at all.
  const { root, journal } = await setup(t), calls: string[] = [];
  await unread(await status(root, journal, reader(SMALL, calls), SMALL, { ...sourceReceipt(SMALL, journal), logs: [] }),
    "circle_delivery_source_event", "no MessageSent");
  assert.deepEqual(calls, [`iris:${journal.transactionHash!.slice(0, 6)}`], "nothing on Solana is read for a message that is not this burn's");
  const message = (change: (bytes: Buffer) => Buffer | void) => withEvent(sourceReceipt(SMALL, journal), change);
  for (const [label, receipt] of [
    ["another destination caller", message(bytes => { bytes[108 + 31]! ^= 1; })],
    ["another min finality", message(bytes => { bytes[143]! ^= 1; })],
    ["another max fee", message(bytes => { bytes[148 + 132 + 31]! ^= 1; })],
    ["another hook", message(bytes => { bytes[bytes.length - 1]! ^= 1; })],
    ["a longer hook", message(bytes => Buffer.concat([bytes, Buffer.alloc(32)]))],
    ["a nonce already in the source event", message(bytes => { bytes[43] = 1; })],
    ["an executed finality already in the source event", message(bytes => { bytes[147] = 1; })],
    ["an executed fee already in the source event", message(bytes => { bytes[148 + 164 + 31] = 1; })],
    ["an expiration already in the source event", message(bytes => { bytes[148 + 196 + 31] = 1; })],
  ] as const) {
    await unread(await status(root, journal, reader(SMALL, []), SMALL, receipt), "circle_delivery_source_message", label);
  }
  await absent(root);
  await assert.rejects(claims(root), { code: "ENOENT" });
});

test("only the burn's one MessageSent from Circle's Base transmitter, in its recorded block, binds the message", async (t) => {
  const { root, journal } = await setup(t);
  const receipt = (change: (value: Json) => void) => { const value = sourceReceipt(SMALL, journal); change(value); return value; };
  const cases: [string, unknown, string, unknown?][] = [
    ["no receipt on this node", null, "circle_delivery_source_receipt"],
    ["another block", receipt(r => { r.blockHash = `0x${H("d")}`; }), "circle_delivery_source_receipt"],
    ["another transaction", receipt(r => { r.transactionHash = `0x${H("d")}`; }), "circle_delivery_source_receipt"],
    ["a reverted receipt", receipt(r => { r.status = "0x0"; }), "circle_delivery_source_receipt"],
    ["two events", receipt(r => { r.logs.push({ ...sent(r), logIndex: "0x200" }); }), "circle_delivery_source_event"],
    ["an event from another emitter", receipt(r => { sent(r).address = `0x${"12".repeat(20)}`; }), "circle_delivery_source_event"],
    ["a removed log", receipt(r => { sent(r).removed = true; }), "circle_delivery_source_event"],
    ["a log of another block", receipt(r => { sent(r).blockHash = `0x${H("d")}`; }), "circle_delivery_source_event"],
    ["a log of another transaction", receipt(r => { sent(r).transactionHash = `0x${H("d")}`; }), "circle_delivery_source_event"],
    ["an indexed topic", receipt(r => { sent(r).topics.push(`0x${H("0")}`); }), "circle_delivery_source_event"],
    ["dirty padding", withEvent(sourceReceipt(SMALL, journal), () => undefined, hex => `${hex.slice(0, -2)}01`), "circle_delivery_source_event"],
    ["another offset", withEvent(sourceReceipt(SMALL, journal), () => undefined, hex => `0x${"40".padStart(64, "0")}${hex.slice(66)}`), "circle_delivery_source_event"],
    ["no block on this node", sourceReceipt(SMALL, journal), "circle_delivery_source_block", null],
    ["another block at that height", sourceReceipt(SMALL, journal), "circle_delivery_source_block", { ...sourceBlock(SMALL.burnTime), hash: `0x${H("d")}` }],
  ];
  for (const [label, answer, reason, block] of cases) {
    await unread(await status(root, journal, reader(SMALL, []), SMALL, answer, block === undefined ? sourceBlock(SMALL.burnTime) : block), reason, label);
  }
  // A noncanonical log index, and a Base read that fails, are unread too; the status still answers.
  const index = await status(root, journal, reader(SMALL, []), SMALL, receipt(r => { sent(r).logIndex = "0x0b7"; }));
  assert.match(index.delivery?.unreadReason ?? "", /^APN_RPC_PROTOCOL: EVM RPC returned a noncanonical quantity/u);
  const limited = await circleSourceStatus(root, journal, () => ({ async call(method) {
    if (method === "eth_getTransactionReceipt") throw new ApnError("APN_RPC_RATE_LIMITED", "The RPC provider requested a cooldown.");
    return await base()(8453).call(method, ["finalized"]);
  } }), () => Date.now(), false, reader(SMALL, []));
  assert.match(limited.delivery?.unreadReason ?? "", /^APN_RPC_RATE_LIMITED/u);
  await absent(root);
  // A MessageSent topic from another emitter beside the real event is not the burn's message and is ignored.
  const beside = receipt(r => { r.logs.unshift({ ...sent(r), address: `0x${"12".repeat(20)}`, logIndex: "0x1" }); });
  assert.equal((await status(root, journal, reader(SMALL, []), SMALL, beside)).phase, "delivered");
});

test("a Solana receive without its block time is not judged", async (t) => {
  const { root, journal } = await setup(t), timeless = copy(SMALL.receive); timeless.blockTime = null;
  await unread(await status(root, journal, reader(SMALL, [], { transaction: timeless })), "solana_block_time_missing", "named receive");
  await unread(await status(root, journal, reader(SMALL, [], { iris: iris(SMALL, m => { m.forwardState = "FAILED"; m.forwardTxHash = null; }),
    transaction: timeless })), "circle_delivery_nonce_unjudged", "receive found through the used-nonce account");
});

test("the attester's four fields may differ from the source event, which leaves them zero; no other byte may", () => {
  const source = Buffer.from((SMALL.iris.messages[0].message as string).slice(2), "hex");
  source.fill(0, 12, 44); source.fill(0, 144, 148);
  const filled = Buffer.from(source);
  for (const [from, to] of [[12, 44], [144, 148], [312, 376]] as const) filled.fill(0xab, from, to);
  assert.equal(attestedFromSource(source, filled), true);
  for (const at of [11, 44, 143, 148, 311, 376, source.length - 1]) {
    const changed = Buffer.from(filled); changed[at]! ^= 1;
    assert.equal(attestedFromSource(source, changed), false, `byte ${at}`);
  }
  for (const at of [12, 147, 312, 375]) {
    const dirty = Buffer.from(source); dirty[at] = 1;
    assert.equal(attestedFromSource(dirty, filled), false, `source byte ${at}`);
  }
  assert.equal(attestedFromSource(source, Buffer.concat([filled, Buffer.alloc(1)])), false);
});

test("a 0.5.76 delivery record is not read: the next status proves the delivery again and leaves the old files as they are", async (t) => {
  const { root, journal } = await setup(t);
  const oldRecord = join(root, "non-evm-source-journals", H("a"), `${H("b")}.solana-delivery.json`);
  const oldClaims = join(root, "circle-solana-delivery-claims");
  await writeFile(oldRecord, "{\"schemaVersion\":\"apn.circle-v2-solana-delivery.v1\"}");
  await mkdir(oldClaims, { mode: 0o700 });
  // An old claim naming another operation does not hold the message any more.
  await writeFile(join(oldClaims, `${(SMALL.iris.messages[0].eventNonce as string).slice(2)}.json`), "{\"operationId\":\"other\"}");
  await unread(await status(root, journal, reader(SMALL, []), SMALL, { ...sourceReceipt(SMALL, journal), logs: [] }),
    "circle_delivery_source_event", "an old record without its source binding");
  const view = await status(root, journal, reader(SMALL, []));
  assert.deepEqual([view.phase, view.delivery?.proof?.schemaVersion], ["delivered", "apn.circle-v2-solana-delivery.v2"]);
  assert.equal(JSON.parse(await readFile(deliveryFile(root), "utf8")).schemaVersion, "apn.circle-v2-solana-delivery.v2");
  assert.equal(JSON.parse(await claims(root)).operationId, H("b"));
  assert.equal(await readFile(oldRecord, "utf8"), "{\"schemaVersion\":\"apn.circle-v2-solana-delivery.v1\"}");
  assert.equal(await claims(root, "circle-solana-delivery-claims"), "{\"operationId\":\"other\"}");
});
