import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { circleSourceStatus } from "../../src/lifi/circle-v2-source-proof.js";
import { absent, base, deliveryFile, H, reader, setup, SMALL, sourceReceipt, status, STATUS, type Json } from "./circle-solana-delivery-fixtures.js";

/**
 * QA 0.5.76 (CIRCLE-DELIVERY-SOURCE-BINDING-076-001): Circle's issuer API answered a new burn's hash with the attested
 * message and Solana receipt of an older burn of the same terms, and the new operation became `delivered`. CCTP V2
 * assigns nonces offchain, so the burn's own `MessageSent` on Base is the chain's anchor: the attested bytes must be that
 * event's message in every byte but the attester's fields (nonce, executed finality, executed fee, expiration block).
 */
const TRANSMITTER = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64";
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

test("another burn's message is not this burn's delivery, however equal their terms", async (t) => {
  // The QA reproduction: a new burn of the same principal to the same token account, whose receipt carries no Circle event.
  const { root, journal } = await setup(t), calls: string[] = [];
  const noEvent = { ...sourceReceipt(SMALL, journal), logs: [] };
  await unread(await status(root, journal, reader(SMALL, calls), SMALL, noEvent), "circle_delivery_source_event", "no MessageSent");
  assert.deepEqual(calls, [`iris:${journal.transactionHash!.slice(0, 6)}`], "nothing on Solana is read for a message that is not this burn's");
  // Its own event differs from the attested message in a byte the burn fixed on chain.
  const message = (change: (bytes: Buffer) => Buffer | void) => withEvent(sourceReceipt(SMALL, journal), change);
  for (const [label, receipt] of [
    ["another destination caller", message(bytes => { bytes[108 + 31]! ^= 1; })],
    ["another min finality", message(bytes => { bytes[143]! ^= 1; })],
    ["another max fee", message(bytes => { bytes[148 + 132 + 31]! ^= 1; })],
    ["another hook", message(bytes => { bytes[bytes.length - 1]! ^= 1; })],
    ["a longer hook", message(bytes => Buffer.concat([bytes, Buffer.alloc(32)]))],
    ["a nonce already in the source event", message(bytes => { bytes[43] = 1; })],
    ["an executed fee already in the source event", message(bytes => { bytes[148 + 164 + 31] = 1; })],
  ] as const) {
    await unread(await status(root, journal, reader(SMALL, []), SMALL, receipt), "circle_delivery_source_message", label);
  }
  await absent(root);
  await assert.rejects(claims(root), { code: "ENOENT" });
});

test("only the burn's one MessageSent from Circle's Base transmitter, in its recorded block, binds the message", async (t) => {
  const { root, journal } = await setup(t);
  const receipt = (change: (value: Json) => void) => { const value = sourceReceipt(SMALL, journal); change(value); return value; };
  const cases: [string, unknown, string][] = [
    ["no receipt on this node", null, "circle_delivery_source_receipt"],
    ["another block", receipt(r => { r.blockHash = `0x${H("d")}`; }), "circle_delivery_source_receipt"],
    ["another transaction", receipt(r => { r.transactionHash = `0x${H("d")}`; }), "circle_delivery_source_receipt"],
    ["a reverted receipt", receipt(r => { r.status = "0x0"; }), "circle_delivery_source_receipt"],
    ["two events", receipt(r => { r.logs.push({ ...sent(r), logIndex: "0x200" }); }), "circle_delivery_source_event"],
    ["an event from another emitter", receipt(r => { sent(r).address = `0x${"12".repeat(20)}`; }), "circle_delivery_source_event"],
    ["a removed log", receipt(r => { sent(r).removed = true; }), "circle_delivery_source_event"],
    ["a log of another block", receipt(r => { sent(r).blockHash = `0x${H("d")}`; }), "circle_delivery_source_event"],
    ["an indexed topic", receipt(r => { sent(r).topics.push(`0x${H("0")}`); }), "circle_delivery_source_event"],
    ["dirty padding", withEvent(sourceReceipt(SMALL, journal), () => undefined, hex => `${hex.slice(0, -2)}01`), "circle_delivery_source_event"],
    ["another offset", withEvent(sourceReceipt(SMALL, journal), () => undefined, hex => `0x${"40".padStart(64, "0")}${hex.slice(66)}`), "circle_delivery_source_event"],
  ];
  for (const [label, answer, reason] of cases) await unread(await status(root, journal, reader(SMALL, []), SMALL, answer), reason, label);
  // A failed Base read is unread too, and the status still answers.
  const limited = await circleSourceStatus(root, journal, () => ({ async call(method) {
    if (method === "eth_getTransactionReceipt") throw new ApnError("APN_RPC_RATE_LIMITED", "The RPC provider requested a cooldown.");
    return await base()(8453).call(method, []);
  } }), () => Date.now(), false, reader(SMALL, []));
  assert.match(limited.delivery?.unreadReason ?? "", /^APN_RPC_RATE_LIMITED/u);
  await absent(root);
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
