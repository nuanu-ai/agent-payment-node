import assert from "node:assert/strict";
import { open, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { CircleSolanaDeliveryStore } from "../../src/lifi/circle-v2-solana-delivery.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { ACCOUNT, burned, deliveryFile, H, reader, recorded, setup, SMALL, sourceBlock, sourceReceipt, status, type Json } from "./circle-solana-delivery-fixtures.js";
import type { NonEvmSourceJournal } from "../../src/lifi/non-evm-source-journal.js";
import { temporaryState } from "./helpers.js";

/**
 * QA 0.5.77 (CIRCLE-OBSERVER-PUBLICATION-RACE-077-001): parallel statuses of one Circle operation failed with
 * APN_STATE_SECURITY "State target appeared during an atomic write." when another observer published the same file while
 * this one was still writing its temporary copy. A create-only write that loses that race meets the same conflict as one
 * that finds the target occupied, which every create-only caller already resolves by reading and validating the winner.
 */
class Files extends SecureStateStore {
  async create(path: string, value: unknown) { await this.writeJson(path, value, true); }
  async replace(path: string, value: unknown) { await this.writeJson(path, value); }
}

/** Runs `rival` once, right after the next file sync: inside an atomic write, between its two checks of the target. */
async function racedAtSync<T>(rival: () => Promise<unknown>, action: () => Promise<T>): Promise<T> {
  const probe = await open(process.execPath, "r"), handle = Object.getPrototypeOf(probe) as { sync(this: unknown): Promise<void> };
  await probe.close();
  const sync = handle.sync;
  let armed = true;
  handle.sync = async function (this: unknown) { await sync.call(this); if (armed) { armed = false; await rival(); } };
  try { return await action(); } finally { handle.sync = sync; }
}
/** Wraps the delivery store's writes: the first one to a path containing `part` runs `rival` inside its atomic write. */
function rivalOnWrite(t: import("node:test").TestContext, part: string, rival: () => Promise<unknown>) {
  const store = CircleSolanaDeliveryStore.prototype as unknown as { writeJson(path: string, value: unknown, createOnly?: boolean): Promise<void> };
  const write = store.writeJson;
  let armed = true;
  store.writeJson = async function (this: unknown, path: string, value: unknown, createOnly?: boolean) {
    if (!armed || !path.includes(part)) return await write.call(this, path, value, createOnly);
    armed = false;
    return await racedAtSync(rival, () => write.call(this, path, value, createOnly));
  };
  t.after(() => { delete (store as { writeJson?: unknown }).writeJson; });
}
/** The burn's real receipt as an unrecorded burn's own, in the finalized block 100 its source proof will record. */
function coldReceipt(journal: NonEvmSourceJournal): Json {
  return { ...sourceReceipt(SMALL, journal), from: ACCOUNT.address, to: journal.sourceCall.to, blockNumber: "0x64" };
}
const CLAIMS = "circle-solana-delivery-claims-v2/";
const security = (message: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_SECURITY" && error.message === message;

test("a create-only write that another writer publishes first is the occupied-target conflict; an ordinary write still refuses", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const files = new Files(temporary.root), path = join(temporary.root, "race.json");
  await files.initialize();
  const rival = () => writeFile(path, `${canonicalJson({ by: "rival" })}\n`, { mode: 0o600, flag: "wx" });
  await assert.rejects(racedAtSync(rival, () => files.create("race.json", { by: "loser" })), security("State target is already occupied."));
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { by: "rival" });
  // A replacing write has no such conflict: a file that appears under it is still refused, as before.
  const other = join(temporary.root, "other.json");
  await assert.rejects(racedAtSync(() => writeFile(other, "{}\n", { mode: 0o600, flag: "wx" }), () => files.replace("other.json", { by: "loser" })),
    security("State target appeared during an atomic write."));
  assert.deepEqual((await readdir(temporary.root)).filter(name => name.endsWith(".tmp")), [], "no temporary copy is left behind");
});

test("a status whose delivery proof another status publishes first returns that proof", async (t) => {
  const { root, journal } = await setup(t), calls: string[] = [];
  let rival: Awaited<ReturnType<typeof status>> | undefined;
  rivalOnWrite(t, ".solana-delivery-v2.json", async () => { rival = await status(root, journal, reader(SMALL, calls)); });
  const view = await status(root, journal, reader(SMALL, calls));
  assert.deepEqual([view.phase, rival?.phase, view.delivery?.operationBinding], ["delivered", "delivered", "circle_attested_nonce"]);
  assert.deepEqual(view.delivery?.proof, rival?.delivery?.proof, "the loser shows the winner's recorded proof");
  assert.deepEqual(JSON.parse(await readFile(deliveryFile(root), "utf8")), rival?.delivery?.proof);
  assert.equal((await readdir(join(root, "circle-solana-delivery-claims-v2"))).length, 1);
});

test("a claim another status of the same operation publishes first is the same claim; another operation's is not", async (t) => {
  const same = await setup(t);
  let rival: Awaited<ReturnType<typeof status>> | undefined;
  rivalOnWrite(t, CLAIMS, async () => { rival = await status(same.root, same.journal, reader(SMALL, [])); });
  const view = await status(same.root, same.journal, reader(SMALL, []));
  assert.deepEqual([view.phase, rival?.phase, view.delivery?.proof?.integrityHash], ["delivered", "delivered", rival?.delivery?.proof?.integrityHash]);
  // A twin burn of the same bytes takes the message's claim inside this operation's claim write: the loser reads it as
  // another operation's, exactly as when the claim was there before.
  const other = await setup(t), twin = await burned(other.root, SMALL, H("c"), 8);
  await recorded(other.root, twin);
  let won: Awaited<ReturnType<typeof status>> | undefined;
  rivalOnWrite(t, CLAIMS, async () => {
    won = await status(other.root, twin, reader(SMALL, []), SMALL, sourceReceipt(SMALL, twin), sourceBlock(SMALL.burnTime + 30n));
  });
  const lost = await status(other.root, other.journal, reader(SMALL, []));
  assert.deepEqual([won?.phase, lost.phase, lost.delivery?.state], ["delivered", "source_finalized", "unread"]);
  assert.ok(lost.delivery?.unreadReason?.endsWith("(circle_delivery_message_claimed)"), lost.delivery?.unreadReason);
});

test("parallel statuses of one burn, its source proof unrecorded, all read delivered with one source proof", async (t) => {
  for (let round = 0; round < 2; round++) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const journal = await burned(temporary.root, SMALL);
    const views = await Promise.all(Array.from({ length: 8 }, () => status(temporary.root, journal, reader(SMALL, []), SMALL, coldReceipt(journal))));
    assert.deepEqual(views.map(view => view.phase), Array(8).fill("delivered"), `round ${round}`);
    assert.equal(new Set(views.map(view => view.sourceProof?.integrityHash)).size, 1);
    assert.equal(new Set(views.map(view => view.delivery?.proof?.integrityHash)).size, 1);
  }
});

test("parallel statuses of one recorded burn all read delivered, with one proof and one claim", async (t) => {
  // The QA reproduction: rounds of 8 ordinary statuses of one operation whose source proof is already recorded.
  for (let round = 0; round < 4; round++) {
    const { root, journal } = await setup(t);
    const views = await Promise.all(Array.from({ length: 8 }, () => status(root, journal, reader(SMALL, []))));
    assert.deepEqual(views.map(view => view.phase), Array(8).fill("delivered"), `round ${round}`);
    const proof = JSON.parse(await readFile(deliveryFile(root), "utf8"));
    for (const view of views) assert.deepEqual(view.delivery?.proof, proof);
    assert.equal((await readdir(join(root, "circle-solana-delivery-claims-v2"))).length, 1);
    assert.deepEqual((await readdir(join(root, "non-evm-source-journals", H("a")))).filter(name => name.endsWith(".tmp")), []);
  }
});
