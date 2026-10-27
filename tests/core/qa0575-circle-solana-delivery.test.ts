import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { circleSolanaDeliveryReader } from "../../src/lifi/circle-v2-solana-delivery.js";
import { absent, ACCOUNT, burned, copy, deliveryFile, H, iris, LARGE, reader, recorded, setup, silent, SMALL, status, STATUS,
  uint256, type Answers, type Json } from "./circle-solana-delivery-fixtures.js";
import { temporaryState } from "./helpers.js";

/**
 * QA 0.5.75: two Circle Base to Solana burns that Circle's forwarding service had delivered within minutes still showed
 * `submitted_pending` with nothing to wait for. The status now proves the receipt on Solana from the chain and records it.
 */
test("Circle's real forwarded receipts are proven on Solana and recorded once; later statuses read nothing", async (t) => {
  for (const burn of [SMALL, LARGE]) {
    const { root, journal } = await setup(t, burn), calls: string[] = [];
    const view = await status(root, journal, reader(burn, calls), burn);
    assert.deepEqual([view.phase, view.waitingFor, view.nextActions, view.proofClass, view.delivery?.state],
      ["delivered", null, [], "chain_verified_public_read", "delivered"], burn.ata);
    assert.deepEqual(calls, [`iris:${journal.transactionHash!.slice(0, 6)}`, "getGenesisHash", "getTransaction"]);
    const message = Buffer.from(burn.iris.messages[0].message.slice(2), "hex"), proof = view.delivery!.proof!;
    const emitted = Buffer.from(message), sent = (burn.receipt.logs as Json[]).find(log => log.address === "0x81d40f21f12a8f0e3252bccb954d722d4c464b64")!;
    emitted.fill(0, 12, 44); emitted.fill(0, 144, 148);
    assert.deepEqual([proof.solanaSignature, proof.burnAtomic, proof.maxFeeAtomic, proof.feeExecutedAtomic, proof.mintedAtomic, proof.recipientAta,
      proof.recipientOwner, proof.eventNonce, proof.messageSha256, proof.sourceTransactionHash, proof.sourceLogIndexAtomic, proof.sourceMessageSha256],
    [burn.signature, burn.amount.toString(), "0", "0", burn.amount.toString(), burn.ata, burn.owner, burn.iris.messages[0].eventNonce,
      createHash("sha256").update(message).digest("hex"), journal.transactionHash, BigInt(sent.logIndex).toString(),
      createHash("sha256").update(emitted).digest("hex")]);
    const again = await status(root, journal, silent);
    assert.deepEqual([again.phase, again.proofClass, again.delivery?.proof], ["delivered", "durable_public_state", proof]);
  }
});

test("each step not finished yet is a waiting status that names it, with its own next actions, and writes nothing", async (t) => {
  const { root, journal } = await setup(t);
  const forward = (state: string | null) => iris(SMALL, m => { m.forwardState = state; m.forwardTxHash = null; });
  const failedGuidance = `Any Solana payer may submit MessageTransmitterV2 receive_message with the message and attestation of https://iris-api.circle.com/v2/messages/6?transactionHash=${journal.transactionHash}; APN does not sign on Solana for this route. Then rerun the same command.`;
  const rpcAction = "Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.";
  const cases: [string, Answers, string, string | null, RegExp, string[]][] = [
    ["not published", { iris: { status: 404, body: null } }, "awaiting_issuer_message", null, /Circle to publish the message/u, []],
    ["no messages yet", { iris: { status: 200, body: { messages: [] } } }, "awaiting_issuer_message", null, /Circle to publish/u, []],
    ["pending without nonce, fee or bytes", { iris: iris(SMALL, m => { m.status = "pending_confirmations"; m.eventNonce = null; m.message = "0x";
      m.attestation = "PENDING"; m.forwardState = null; m.forwardTxHash = null; delete m.decodedMessage.decodedMessageBody.feeExecuted; }) },
    "awaiting_attestation", null, /status pending_confirmations/u, []],
    ["forward pending, no receiver yet", { iris: forward("PENDING"), receivers: [] }, "awaiting_forward", "PENDING", /forwardState PENDING/u, []],
    ["forward failed, no receiver yet", { iris: forward("FAILED"), receivers: [] }, "forward_failed", "FAILED", /forwarding failed/u, [failedGuidance]],
    ["forward failed, no Solana RPC", { iris: forward("FAILED"), solana: null }, "forward_failed", "FAILED", /forwarding failed/u, [failedGuidance, rpcAction]],
    ["named, no Solana RPC", { solana: null }, "awaiting_solana_rpc", "COMPLETE", new RegExp(`APN_SOLANA_RPC_URL to read the Solana transaction ${SMALL.signature}`, "u"), [rpcAction]],
    ["named, not finalized", { transaction: null }, "awaiting_solana_finality", "COMPLETE", new RegExp(`${SMALL.signature} at finalized`, "u"), []],
  ];
  for (const [label, answers, state, forwardState, waiting, actions] of cases) {
    const view = await status(root, journal, reader(SMALL, [], answers));
    assert.deepEqual([view.phase, view.delivery?.state, view.delivery?.forwardState, view.delivery?.proof, view.nextActions],
      ["source_finalized", state, forwardState, null, [...actions, STATUS]], label);
    assert.match(view.waitingFor ?? "", waiting, label);
    await absent(root);
  }
});

test("a message received by someone other than Circle's forwarder is found through its used-nonce account", async (t) => {
  const { root, journal } = await setup(t), calls: string[] = [];
  const failed = () => iris(SMALL, m => { m.forwardState = "FAILED"; m.forwardTxHash = null; });
  const view = await status(root, journal, reader(SMALL, calls, { iris: failed() }));
  assert.deepEqual([view.phase, view.delivery?.proof?.solanaSignature], ["delivered", SMALL.signature]);
  assert.deepEqual(calls.slice(1), ["getGenesisHash", "getSignaturesForAddress", "getTransaction"]);
});

test("anyone naming the public used-nonce account neither blocks nor fakes the receive found through it", async (t) => {
  // A stranger's successful transaction that names the account but receives nothing; a failed row; a full page of strangers.
  const strangerSignature = (n: number) => getBase58Decoder().decode(new Uint8Array(64).fill(n + 1));
  const strangerTx = (signature: string) => { const value = copy(SMALL.receive); value.transaction.signatures[0] = signature;
    value.transaction.message.instructions = value.transaction.message.instructions.slice(0, 2); return value; };
  const row = (signature: string, err: unknown = null) => ({ ...SMALL.receivers[0], signature, err });
  const stranger = strangerSignature(0), transactions = { [SMALL.signature]: SMALL.receive, [stranger]: strangerTx(stranger) };
  const failed = () => iris(SMALL, m => { m.forwardState = "FAILED"; m.forwardTxHash = null; });
  const { root, journal } = await setup(t);
  const before = await status(root, journal, reader(SMALL, [], { iris: failed(), receivers: [row(stranger)], transactions }));
  assert.deepEqual([before.delivery?.state, before.nextActions.length], ["forward_failed", 2], "a stranger before the receive is not a receipt");
  const page = Array.from({ length: 16 }, (_, n) => row(strangerSignature(n)));
  const flooded = await status(root, journal, reader(SMALL, [], { iris: failed(), receivers: page,
    transactions: Object.fromEntries(page.map(entry => [entry.signature, strangerTx(entry.signature)])) }));
  assert.deepEqual([flooded.delivery?.state, flooded.delivery?.unreadReason?.endsWith("(circle_delivery_nonce_history)")], ["unread", true]);
  // A candidate the node does not return, or one too large to judge, is not "not received": it stays unread.
  const huge = getBase58Decoder().decode(new Uint8Array(64).fill(99)), oversized = strangerTx(huge);
  oversized.transaction.message.accountKeys = Array.from({ length: 257 }, (_, n) => ({ pubkey: strangerSignature(n).slice(0, 44), signer: false, writable: false }));
  for (const answers of [{ receivers: [row(stranger)], transactions: { [SMALL.signature]: SMALL.receive } },
    { receivers: [row(huge)], transactions: { [huge]: oversized } }]) {
    const unjudged = await status(root, journal, reader(SMALL, [], { iris: failed(), ...answers }));
    assert.deepEqual([unjudged.delivery?.state, unjudged.delivery?.unreadReason?.endsWith("(circle_delivery_nonce_unjudged)")], ["unread", true]);
  }
  await absent(root);
  for (const [label, receivers] of [["stranger after the receive", [row(stranger), row(SMALL.signature)]],
    ["stranger before the receive", [row(SMALL.signature), row(stranger)]],
    ["a failed attempt beside it", [row(LARGE.signature, { InstructionError: [3, { Custom: 0 }] }), row(SMALL.signature)]],
    ["an unjudged stranger before it", [row(SMALL.signature), row(huge)]]] as const) {
    const fresh = await setup(t);
    const view = await status(fresh.root, fresh.journal, reader(SMALL, [], { iris: failed(), receivers, transactions: { ...transactions, [huge]: oversized } }));
    assert.deepEqual([view.phase, view.delivery?.proof?.solanaSignature], ["delivered", SMALL.signature], label);
  }
});

test("an answer that is not this burn's, or a failed read, leaves the delivery unread with its reason and the status answering", async (t) => {
  const { root, journal } = await setup(t);
  const tx = (change: (r: Json) => void) => { const value = copy(SMALL.receive); change(value); return value; };
  const ataIndex = (SMALL.receive.transaction.message.accountKeys as Json[]).findIndex(key => key.pubkey === SMALL.ata);
  const post = (r: Json) => (r.meta.postTokenBalances as Json[]).find(row => row.accountIndex === BigInt(ataIndex))!;
  const transmitter = (r: Json) => (r.transaction.message.instructions as Json[]).find(i => i.programId === "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC")!;
  const nonceKey = (r: Json) => (r.transaction.message.accountKeys as Json[]).find(key => key.pubkey === "HQmwr7wL8yWSYbArQ3fhPc2gsQfHKsQH3wnir8NYvvnM")!;
  const cases: [string, Answers, RegExp][] = [
    ["two messages of this burn", { iris: iris(SMALL, (m, _b, body) => { body.messages.push(copy(m)); }) }, /APN_PROVIDER_PROTOCOL.*circle_delivery_messages/u],
    // Iris may not choose the fee: a fee above the attested max fee, or bytes the Solana receive does not carry, prove nothing.
    ["fee above the max fee", { iris: iris(SMALL, (_m, bytes) => { uint256(bytes, 148 + 164, 70_000n); }) }, /circle_delivery_message_bytes/u],
    ["bytes the burn did not emit", { iris: iris(SMALL, (_m, bytes) => { uint256(bytes, 148 + 132, 70_000n); uint256(bytes, 148 + 164, 70_000n); }) }, /circle_delivery_source_message/u],
    ["bytes Solana did not receive", { iris: iris(SMALL, (_m, bytes) => { uint256(bytes, 148 + 196, 1n); }) }, /circle_delivery_message\)/u],
    ["another amount in the bytes", { iris: iris(SMALL, (_m, bytes) => { uint256(bytes, 148 + 68, 170_001n); }) }, /circle_delivery_message_bytes/u],
    ["another nonce beside the bytes", { iris: iris(SMALL, m => { m.eventNonce = `0x${H("7")}`; }) }, /circle_delivery_nonce/u],
    ["forward hash not a signature", { iris: iris(SMALL, m => { m.forwardTxHash = "0xabc"; }) }, /circle_delivery_forward_tx/u],
    ["issuer unavailable", { iris: { status: 503, body: null } }, /APN_PROVIDER_UNAVAILABLE.*issuer_http_status/u],
    ["issuer rate limit", { iris: { status: 429, body: null } }, /APN_PROVIDER_UNAVAILABLE/u],
    ["Solana rate limit", { fail: new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC provider requested a cooldown.") }, /APN_RPC_RATE_LIMITED/u],
    ["failed transaction", { transaction: tx(r => { r.meta.err = { InstructionError: [2, "Custom"] }; }) }, /circle_delivery_transaction_failed/u],
    ["another signature", { transaction: tx(r => { r.transaction.signatures[0] = LARGE.signature; }) }, /circle_delivery_signature/u],
    ["no transmitter call", { transaction: tx(r => { r.transaction.message.instructions = r.transaction.message.instructions.slice(0, 2); }) }, /circle_delivery_message\)/u],
    ["another message received", { transaction: tx(r => { transmitter(r).data = (LARGE.receive.transaction.message.instructions as Json[]).at(-1)!.data; }) }, /circle_delivery_message\)/u],
    ["used nonce only read", { transaction: tx(r => { nonceKey(r).writable = false; }) }, /circle_delivery_used_nonce/u],
    ["one atom short", { transaction: tx(r => { const row = post(r); row.uiTokenAmount.amount = (BigInt(row.uiTokenAmount.amount) - 1n).toString(); }) }, /circle_delivery_amount/u],
    ["another owner", { transaction: tx(r => { post(r).owner = ACCOUNT.address; }) }, /circle_delivery_balance/u],
    ["another mint", { transaction: tx(r => { post(r).mint = SMALL.owner; }) }, /circle_delivery_balance/u],
  ];
  for (const [label, answers, reason] of cases) {
    const view = await status(root, journal, reader(SMALL, [], answers));
    assert.deepEqual([view.phase, view.delivery?.state, view.nextActions.at(-1)], ["source_finalized", "unread", STATUS], label);
    assert.match(view.delivery?.unreadReason ?? "", reason, label);
    assert.equal(view.waitingFor, `a delivery read that succeeds; the last one failed: ${view.delivery?.unreadReason}`, label);
    await absent(root);
  }
});

test("one Solana receipt proves one operation: a second burn naming the same message stays unread", async (t) => {
  const { root, journal } = await setup(t);
  assert.equal((await status(root, journal, reader(SMALL, []))).phase, "delivered");
  const other = await burned(root, SMALL, H("c"), 8); await recorded(root, other);
  const view = await status(root, other, reader(SMALL, []));
  assert.deepEqual([view.delivery?.state, view.delivery?.unreadReason?.endsWith("(circle_delivery_message_claimed)")], ["unread", true]);
  assert.equal(await readFile(deliveryFile(root, H("c"))).then(() => true, () => false), false);
});

test("a reverted burn reads no delivery; without readers, or with a journal whose recipient disagrees, nothing is guessed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root, SMALL); await recorded(temporary.root, journal, "reverted");
  const reverted = await status(temporary.root, journal, silent);
  assert.deepEqual([reverted.phase, reverted.delivery, reverted.waitingFor], ["source_reverted", undefined, null]);
  const { root, journal: succeeded } = await setup(t);
  await assert.rejects(status(root, succeeded), (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  const mismatched = { ...succeeded, admissionProof: { ...succeeded.admissionProof, recipientAta: LARGE.ata } };
  await assert.rejects(status(root, mismatched, reader(SMALL, [])),
    (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT" && error.details?.reason === "circle_delivery_terms");
});

test("a recorded delivery that its journal does not allow is corrupt state", async (t) => {
  const { root, journal } = await setup(t);
  await status(root, journal, reader(SMALL, []));
  const stored = JSON.parse(await readFile(deliveryFile(root), "utf8")) as Json;
  for (const change of [(p: Json) => { p.mintedAtomic = "169999"; }, (p: Json) => { p.recipientAta = SMALL.owner; },
    (p: Json) => { p.feeExecutedAtomic = "1"; p.mintedAtomic = "169999"; }, (p: Json) => { p.burnAtomic = "170001"; p.mintedAtomic = "170001"; }]) {
    const { integrityHash: _, ...fields } = stored, tampered: Json = { ...fields };
    change(tampered);
    await writeFile(deliveryFile(root), JSON.stringify({ ...tampered, integrityHash: hashObject(tampered) }));
    await assert.rejects(status(root, journal, silent), (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
  }
});

test("the production reader asks Circle's pinned origin for the burn's messages and passes a non-200 answer through", async () => {
  const requests: unknown[][] = [];
  const answers = [{ status: 200, body: JSON.stringify(SMALL.iris) }, { status: 404, body: "{\"error\":\"Message not found\"}" }, { status: 200, body: "<html>" }];
  const port = circleSolanaDeliveryReader(null, { async request(...args: unknown[]) { requests.push(args); return answers.shift()!; } } as never);
  const hash = `0x${"ab".repeat(32)}`;
  assert.deepEqual(await port.issuerMessages(hash), { status: 200, body: SMALL.iris });
  assert.deepEqual(await port.issuerMessages(hash), { status: 404, body: null });
  await assert.rejects(port.issuerMessages(hash), (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_PROTOCOL");
  await assert.rejects(port.issuerMessages("0x12"), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL");
  assert.deepEqual(requests[0], [`https://iris-api.circle.com/v2/messages/6?transactionHash=${hash}`, "GET", null, 1024 * 1024, "APN_HTTP_CONFIG"]);
  assert.deepEqual([requests.length, port.solana], [3, null]);
});
