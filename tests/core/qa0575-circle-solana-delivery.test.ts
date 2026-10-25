import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import type { FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import { circleSolanaDeliveryReader, type CircleSolanaDeliveryReader } from "../../src/lifi/circle-v2-solana-delivery.js";
import { CIRCLE_SOURCE_PROOF_SCHEMA, CircleSourceProofStore, circleSourceStatus } from "../../src/lifi/circle-v2-source-proof.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "../../src/lifi/non-evm-source-journal.js";
import { temporaryState } from "./helpers.js";

/**
 * QA 0.5.75: two Circle Base to Solana burns that Circle's forwarding service had delivered within minutes still showed
 * `submitted_pending` with nothing to wait for. The status now proves the receipt on Solana from the chain and records it.
 */
type Json = Record<string, any>;
const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), H = (c: string) => c.repeat(64);
const BURN = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const fixture = async (name: string, parse: (text: string) => unknown): Promise<Json> =>
  parse(await readFile(join(process.cwd(), `tests/fixtures/circle-solana-delivery/${name}.json`), "utf8")) as Json;
/** Two real deliveries: to an existing token account, and one created by the receiving transaction (read without bigints). */
const SMALL = { amount: 170_000n, owner: "3C2rcV1uQpFX79cY7ALfKeJiD7JiLQFvSB2kZjjE11Yv", ata: "BJRwCA3CXCoPqBAutrJvcHoRgQmyfJv6xo7bupwubgqy",
  signature: "2M7FC4TwiVmJ9YKZ4nAiWVjffeZdUoow1guXk9tqjZAs3dKXVQwZtXuogY65rYffwBd8Led6nSHAvJ8P1opt5ppV",
  iris: await fixture("iris-message-170000", JSON.parse), receive: await fixture("solana-receive-170000", parseJsonWithBigInts),
  receivers: await fixture("used-nonce-signatures-170000", parseJsonWithBigInts) };
const LARGE = { amount: 1_000_000n, owner: "2i72eWcpDU862RVwGaGCos2PHoQgYTphjfJpxcv5W1EJ", ata: "gYgbhjCMBwLKvFa4Tn2dDW3dRY2a4CwPtkT27feuVr7",
  signature: "5kbzTzCCWMmeZ48a4Mp5rmMZRaZponimWj8UD7Ca1stBsRCat7RfpxYPr3FbMiPMAkRHNytqhz1SKWpqmqZUSmrg",
  iris: await fixture("iris-message-1000000", JSON.parse), receive: await fixture("solana-receive-1000000", JSON.parse), receivers: [] as Json };
type Case = typeof SMALL;
const copy = <T>(value: T): T => structuredClone(value);
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const STATUS = `apn operation status --operation ${H("b")}`;

/** A burn to the case's recipient, sent once and left `submitted_pending`; its calldata names the recipient's token account. */
async function burned(root: string, burn: Case, operationId = H("b"), nonce = 7): Promise<NonEvmSourceJournal> {
  const recipient = `0x${Buffer.from(getBase58Encoder().encode(burn.ata)).toString("hex")}` as Hex;
  const data = encodeFunctionData({ abi: BURN, functionName: "depositForBurnWithHookAndFees", args: [burn.amount, 5, recipient,
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", `0x${"00".repeat(32)}`, "0x", { signedQuote: "0x01", refundAddress: ACCOUNT.address }] });
  const repo = new NonEvmSourceJournalRepository(root);
  let j = await repo.stageLiveCircle({ profileHash: H("a"), operationId, draftIntegrityHash: H("c"), route: "base_usdc_to_solana_usdc_circle_cctp_v2",
    createdAt: at(0), maxSourceNativeDebitWei: "1000000000000000",
    sourceCall: { chainId: 8453, from: ACCOUNT.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, valueAtomic: "0", data,
      dataSha256: sha256(Buffer.from(data.slice(2), "hex")), type: "eip1559", nonceAtomic: String(nonce), gasLimitAtomic: "100000",
      maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
    admissionProof: { kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com", rpcOrigin: "https://base.example.org",
      quoteHash: H("d"), validationHash: H("d"), sourceBlockHash: `0x${H("9")}`, preparationDigest: H("8"), payer: ACCOUNT.address,
      recipientOwner: burn.owner, recipientAta: burn.ata, feeTotalAtomic: "131130" }, protocolInputHash: H("1") });
  const raw = await ACCOUNT.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data, value: 0n, nonce,
    gas: 100000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, String(nonce), at(2));
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(3));
  return await repo.observePending(j.profileHash, j.operationId, j.integrityHash, at(4));
}
async function recorded(root: string, journal: NonEvmSourceJournal, status: "success" | "reverted" = "success"): Promise<void> {
  const fields = { schemaVersion: CIRCLE_SOURCE_PROOF_SCHEMA as typeof CIRCLE_SOURCE_PROOF_SCHEMA, operationId: journal.operationId,
    profileHash: journal.profileHash, chainId: 8453 as const, payer: journal.sourceCall.from, to: journal.sourceCall.to,
    transactionHash: journal.transactionHash!, nonceAtomic: journal.nonceAtomic!, status, blockNumberAtomic: "100",
    blockHash: `0x${H("e")}`, blockTag: "finalized" as const, finalizedBlockNumberAtomic: "100", observedAt: at(5) };
  await new CircleSourceProofStore(root).create(journal, { ...fields, integrityHash: hashObject(fields) });
}
/** Base at the finalized tag: only the residual allowance read reaches it once the receipt is recorded. */
const base = (): ((chainId: number) => FinalizedChainRead) => () => ({ async call(method) {
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_getBlockByNumber") return { number: "0x64", hash: `0x${H("f")}` };
  if (method === "eth_call") return `0x${"0".repeat(64)}`;
  throw new Error(`unexpected ${method}`);
} });
interface Answers { iris?: { status: number; body: unknown }; transaction?: unknown; transactions?: Record<string, unknown>; receivers?: unknown; solana?: null; fail?: ApnError }
/** Circle and Solana as the case's fixtures answer them, each read logged. */
function reader(burn: Case, calls: string[], answers: Answers = {}): CircleSolanaDeliveryReader {
  return {
    async issuerMessages(hash) { calls.push(`iris:${hash.slice(0, 6)}`); return copy(answers.iris ?? { status: 200, body: burn.iris }); },
    solana: answers.solana === null ? null : { originHash: "fixture", async call(method, params) {
      calls.push(method);
      if (answers.fail !== undefined) throw answers.fail;
      if (method === "getGenesisHash") return SOLANA_GENESIS;
      if (method === "getTransaction") {
        if ("transaction" in answers) return copy(answers.transaction);
        return copy((answers.transactions ?? { [burn.signature]: burn.receive })[params[0] as string] ?? null);
      }
      if (method === "getSignaturesForAddress") return copy(answers.receivers ?? burn.receivers);
      throw new Error(`unexpected ${method}`);
    } },
  };
}
const silent = { solana: { originHash: "none", async call() { throw new Error("no Solana read expected"); } },
  async issuerMessages() { throw new Error("no issuer read expected"); } } satisfies CircleSolanaDeliveryReader;
const deliveryFile = (root: string, id = H("b")) => join(root, "non-evm-source-journals", H("a"), `${id}.solana-delivery.json`);
const absent = async (root: string) => assert.equal(await readFile(deliveryFile(root)).then(() => true, () => false), false);
async function setup(t: import("node:test").TestContext, burn: Case = SMALL) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root, burn); await recorded(temporary.root, journal);
  return { root: temporary.root, journal };
}
const status = (root: string, journal: NonEvmSourceJournal, delivery?: CircleSolanaDeliveryReader) =>
  circleSourceStatus(root, journal, base(), () => Date.now(), false, delivery);
/** Circle's message with its decoded fields or its attested bytes changed. */
function iris(burn: Case, change: (message: Json, bytes: Buffer, body: Json) => void) {
  const body = copy(burn.iris), message = body.messages[0], bytes = Buffer.from(message.message.slice(2), "hex");
  change(message, bytes, body);
  if (typeof message.message === "string" && message.message.length > 2) message.message = `0x${bytes.toString("hex")}`;
  return { status: 200, body };
}
const uint256 = (bytes: Buffer, offset: number, value: bigint) => { Buffer.from(value.toString(16).padStart(64, "0"), "hex").copy(bytes, offset); };

test("Circle's real forwarded receipts are proven on Solana and recorded once; later statuses read nothing", async (t) => {
  for (const burn of [SMALL, LARGE]) {
    const { root, journal } = await setup(t, burn), calls: string[] = [];
    const view = await status(root, journal, reader(burn, calls));
    assert.deepEqual([view.phase, view.waitingFor, view.nextActions, view.proofClass, view.delivery?.state],
      ["delivered", null, [], "chain_verified_public_read", "delivered"], burn.ata);
    assert.deepEqual(calls, [`iris:${journal.transactionHash!.slice(0, 6)}`, "getGenesisHash", "getTransaction"]);
    const message = Buffer.from(burn.iris.messages[0].message.slice(2), "hex"), proof = view.delivery!.proof!;
    assert.deepEqual([proof.solanaSignature, proof.burnAtomic, proof.maxFeeAtomic, proof.feeExecutedAtomic, proof.mintedAtomic, proof.recipientAta,
      proof.recipientOwner, proof.eventNonce, proof.messageSha256, proof.sourceTransactionHash],
    [burn.signature, burn.amount.toString(), "0", "0", burn.amount.toString(), burn.ata, burn.owner, burn.iris.messages[0].eventNonce,
      createHash("sha256").update(message).digest("hex"), journal.transactionHash]);
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
  await absent(root);
  for (const [label, receivers] of [["stranger after the receive", [row(stranger), row(SMALL.signature)]],
    ["stranger before the receive", [row(SMALL.signature), row(stranger)]],
    ["a failed attempt beside it", [row(LARGE.signature, { InstructionError: [3, { Custom: 0 }] }), row(SMALL.signature)]]] as const) {
    const fresh = await setup(t);
    const view = await status(fresh.root, fresh.journal, reader(SMALL, [], { iris: failed(), receivers, transactions }));
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
    ["bytes Solana did not receive", { iris: iris(SMALL, (_m, bytes) => { uint256(bytes, 148 + 132, 70_000n); uint256(bytes, 148 + 164, 70_000n); }) }, /circle_delivery_message\)/u],
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
  const view = await circleSourceStatus(root, other, base(), () => Date.now(), false, reader(SMALL, []));
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
