import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { ApnError } from "../../src/errors.js";
import type { FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import { circleSolanaDeliveryReader, type CircleSolanaDeliveryReader } from "../../src/lifi/circle-v2-solana-delivery.js";
import { CIRCLE_SOURCE_PROOF_SCHEMA, CircleSourceProofStore, circleSourceStatus } from "../../src/lifi/circle-v2-source-proof.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "../../src/lifi/non-evm-source-journal.js";
import type { SolanaMethod } from "../../src/solana/rpc.js";
import { temporaryState } from "./helpers.js";

/**
 * QA 0.5.75: two Circle Base to Solana burns that Circle's forwarding service had delivered within minutes still showed
 * `submitted_pending` with nothing to wait for. The status now proves the receipt on Solana from the chain and records it.
 */
type Json = Record<string, any>;
const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), H = (c: string) => c.repeat(64);
const OWNER = "3C2rcV1uQpFX79cY7ALfKeJiD7JiLQFvSB2kZjjE11Yv", ATA = "BJRwCA3CXCoPqBAutrJvcHoRgQmyfJv6xo7bupwubgqy";
const SIGNATURE = "2M7FC4TwiVmJ9YKZ4nAiWVjffeZdUoow1guXk9tqjZAs3dKXVQwZtXuogY65rYffwBd8Led6nSHAvJ8P1opt5ppV";
const BURN = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
/** Read as each production client parses it: the Solana RPC turns every JSON integer into a bigint. */
const fixture = async (name: string, parse: (text: string) => unknown = JSON.parse): Promise<Json> =>
  parse(await readFile(join(process.cwd(), `tests/fixtures/circle-solana-delivery/${name}.json`), "utf8")) as Json;
const IRIS = await fixture("iris-message-170000"), RECEIVE = await fixture("solana-receive-170000", parseJsonWithBigInts);
const copy = <T>(value: T): T => structuredClone(value);
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A 170000-atom burn to the fixture's recipient, sent once and left `submitted_pending`. */
async function burned(root: string): Promise<NonEvmSourceJournal> {
  const data = encodeFunctionData({ abi: BURN, functionName: "depositForBurnWithHookAndFees", args: [170_000n, 5, `0x${"22".repeat(32)}`,
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", `0x${"00".repeat(32)}`, "0x", { signedQuote: "0x01", refundAddress: ACCOUNT.address }] });
  const repo = new NonEvmSourceJournalRepository(root);
  let j = await repo.stageLiveCircle({ profileHash: H("a"), operationId: H("b"), draftIntegrityHash: H("c"), route: "base_usdc_to_solana_usdc_circle_cctp_v2",
    createdAt: at(0), maxSourceNativeDebitWei: "1000000000000000",
    sourceCall: { chainId: 8453, from: ACCOUNT.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, valueAtomic: "0", data,
      dataSha256: sha256(Buffer.from(data.slice(2), "hex")), type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
      maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
    admissionProof: { kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com", rpcOrigin: "https://base.example.org",
      quoteHash: H("d"), validationHash: H("d"), sourceBlockHash: `0x${H("9")}`, preparationDigest: H("8"), payer: ACCOUNT.address,
      recipientOwner: OWNER, recipientAta: ATA, feeTotalAtomic: "131130" }, protocolInputHash: H("1") });
  const raw = await ACCOUNT.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data, value: 0n, nonce: 7,
    gas: 100000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, "7", at(2));
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
/** Circle and Solana as the fixtures answer them, each read logged. */
function reader(calls: string[], iris: { status: number; body: unknown } = { status: 200, body: IRIS },
  transaction: unknown = RECEIVE): CircleSolanaDeliveryReader {
  return {
    async issuerMessages(hash) { calls.push(`iris:${hash.slice(0, 6)}`); return copy(iris); },
    solana: { originHash: "fixture", async call(method: SolanaMethod, params: readonly unknown[]) {
      calls.push(method);
      if (method === "getGenesisHash") return SOLANA_GENESIS;
      if (method === "getTransaction") {
        assert.deepEqual(params, [SIGNATURE, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
        return copy(transaction);
      }
      throw new Error(`unexpected ${method}`);
    } },
  };
}
const silent = { solana: { originHash: "none", async call() { throw new Error("no Solana read expected"); } },
  async issuerMessages() { throw new Error("no issuer read expected"); } } satisfies CircleSolanaDeliveryReader;
const deliveryFile = (root: string) => join(root, "non-evm-source-journals", H("a"), `${H("b")}.solana-delivery.json`);
const absent = async (root: string) => assert.equal(await readFile(deliveryFile(root)).then(() => true, () => false), false);
async function setup(t: import("node:test").TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root); await recorded(temporary.root, journal);
  return { root: temporary.root, journal };
}
const status = (root: string, journal: NonEvmSourceJournal, delivery?: CircleSolanaDeliveryReader) =>
  circleSourceStatus(root, journal, base(), () => Date.now(), false, delivery);

test("Circle's real forwarded receipt is proven on Solana and recorded once; later statuses read nothing", async (t) => {
  const { root, journal } = await setup(t), calls: string[] = [];
  const view = await status(root, journal, reader(calls));
  assert.deepEqual([view.phase, view.waitingFor, view.nextActions, view.proofClass, view.delivery?.state],
    ["delivered", null, [], "chain_verified_public_read", "delivered"]);
  assert.deepEqual(calls, [`iris:${journal.transactionHash!.slice(0, 6)}`, "getGenesisHash", "getTransaction"]);
  const proof = view.delivery!.proof!;
  assert.deepEqual([proof.solanaSignature, proof.slotAtomic, proof.burnAtomic, proof.feeExecutedAtomic, proof.mintedAtomic, proof.recipientAta,
    proof.recipientOwner, proof.eventNonce, proof.sourceTransactionHash],
  [SIGNATURE, "458899277", "170000", "0", "170000", ATA, OWNER, IRIS.messages[0].eventNonce, journal.transactionHash]);
  const again = await status(root, journal, silent);
  assert.deepEqual([again.phase, again.proofClass, again.delivery?.proof], ["delivered", "durable_public_state", proof]);
});

test("each step Circle has not finished is a waiting status that names it and writes nothing", async (t) => {
  const { root, journal } = await setup(t);
  const message = (change: (m: Json) => void) => { const body = copy(IRIS); change(body.messages[0]); return { status: 200, body }; };
  const cases: [string, { status: number; body: unknown }, unknown, string, string | null, RegExp][] = [
    ["not published", { status: 404, body: null }, RECEIVE, "awaiting_issuer_message", null, /Circle to publish the message/u],
    ["no messages yet", { status: 200, body: { messages: [] } }, RECEIVE, "awaiting_issuer_message", null, /Circle to publish/u],
    ["not attested", message(m => { m.status = "pending_confirmations"; m.forwardState = null; m.forwardTxHash = null; }), RECEIVE,
      "awaiting_attestation", null, /status pending_confirmations/u],
    ["forward pending", message(m => { m.forwardState = "PENDING"; m.forwardTxHash = null; }), RECEIVE, "awaiting_forward", "PENDING", /forwardState PENDING/u],
    ["forward failed", message(m => { m.forwardState = "FAILED"; m.forwardTxHash = null; }), RECEIVE, "awaiting_forward", "FAILED", /forwardState FAILED/u],
    ["not finalized on Solana", { status: 200, body: IRIS }, null, "awaiting_solana_finality", "COMPLETE", new RegExp(`${SIGNATURE} to be finalized`, "u")],
  ];
  for (const [label, iris, transaction, state, forwardState, waiting] of cases) {
    const view = await status(root, journal, reader([], iris, transaction));
    assert.deepEqual([view.phase, view.delivery?.state, view.delivery?.forwardState, view.delivery?.proof, view.nextActions],
      ["source_finalized", state, forwardState, null, [`apn operation status --operation ${H("b")}`]], label);
    assert.match(view.waitingFor ?? "", waiting, label);
    await absent(root);
  }
  // Without an explicit APN_SOLANA_RPC_URL nothing is read from a default endpoint: the status names the setting.
  const unconfigured = await status(root, journal, { ...reader([]), solana: null });
  assert.deepEqual([unconfigured.phase, unconfigured.delivery?.state, unconfigured.waitingFor, unconfigured.nextActions],
    ["source_finalized", "awaiting_solana_rpc", `APN_SOLANA_RPC_URL to read the Solana transaction ${SIGNATURE}`,
      ["Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.", `apn operation status --operation ${H("b")}`]]);
  await absent(root);
});

test("a message or a Solana transaction that is not this burn's is refused and nothing is recorded", async (t) => {
  const { root, journal } = await setup(t);
  const iris = (change: (m: Json, body: Json) => void) => { const body = copy(IRIS); change(body.messages[0], body); return { status: 200, body }; };
  const tx = (change: (r: Json) => void) => { const value = copy(RECEIVE); change(value); return value; };
  const ataIndex = (RECEIVE.transaction.message.accountKeys as Json[]).findIndex(key => key.pubkey === ATA);
  const post = (r: Json) => (r.meta.postTokenBalances as Json[]).find(row => row.accountIndex === BigInt(ataIndex))!;
  const unbound = await status(root, journal, reader([], iris(m => { m.decodedMessage.decodedMessageBody.mintRecipient = OWNER; })));
  assert.equal(unbound.delivery?.state, "awaiting_issuer_message", "another recipient's message is not this burn's");
  const otherAmount = await status(root, journal, reader([], iris(m => { m.decodedMessage.decodedMessageBody.amount = "170001"; })));
  assert.equal(otherAmount.delivery?.state, "awaiting_issuer_message");
  const refusals: [string, ReturnType<typeof reader>, string][] = [
    ["two bound messages", reader([], iris((m, body) => { body.messages.push(copy(m)); })), "APN_PROVIDER_PROTOCOL"],
    ["fee at the principal", reader([], iris(m => { m.decodedMessage.decodedMessageBody.feeExecuted = "170000"; })), "APN_PROVIDER_PROTOCOL"],
    ["forward hash not a signature", reader([], iris(m => { m.forwardTxHash = "0xabc"; })), "APN_RPC_PROTOCOL"],
    ["issuer unavailable", reader([], { status: 503, body: null }), "APN_PROVIDER_UNAVAILABLE"],
    ["failed transaction", reader([], undefined, tx(r => { r.meta.err = { InstructionError: [2, "Custom"] }; })), "APN_RPC_PROTOCOL"],
    ["another signature", reader([], undefined, tx(r => { r.transaction.signatures[0] = RECEIVE.transaction.signatures[0].replace(/^2/u, "3"); })), "APN_RPC_PROTOCOL"],
    ["no message transmitter call", reader([], undefined, tx(r => { r.transaction.message.instructions = r.transaction.message.instructions.slice(0, 2); })), "APN_RPC_PROTOCOL"],
    ["another nonce", reader([], iris(m => { m.eventNonce = `0x${H("7")}`; })), "APN_RPC_PROTOCOL"],
    ["one atom short", reader([], undefined, tx(r => { const row = post(r); row.uiTokenAmount.amount = (BigInt(row.uiTokenAmount.amount) - 1n).toString(); })), "APN_RPC_PROTOCOL"],
    ["another owner", reader([], undefined, tx(r => { post(r).owner = ACCOUNT.address; })), "APN_RPC_PROTOCOL"],
    ["another mint", reader([], undefined, tx(r => { post(r).mint = OWNER; })), "APN_RPC_PROTOCOL"],
  ];
  for (const [label, port, code] of refusals) {
    await assert.rejects(status(root, journal, port), (error: unknown) => error instanceof ApnError && error.code === code, label);
    await absent(root);
  }
});

test("a reverted burn reads no delivery; a successful one without the readers names the missing capability", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root); await recorded(temporary.root, journal, "reverted");
  const reverted = await status(temporary.root, journal, silent);
  assert.deepEqual([reverted.phase, reverted.delivery, reverted.waitingFor], ["source_reverted", undefined, null]);
  const { root, journal: succeeded } = await setup(t);
  await assert.rejects(status(root, succeeded), (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
});

test("a recorded delivery that its journal does not allow is corrupt state", async (t) => {
  const { root, journal } = await setup(t);
  await status(root, journal, reader([]));
  const stored = JSON.parse(await readFile(deliveryFile(root), "utf8")) as Json;
  for (const change of [(p: Json) => { p.mintedAtomic = "169999"; }, (p: Json) => { p.recipientAta = OWNER; }, (p: Json) => { p.burnAtomic = "170001"; p.mintedAtomic = "170001"; }]) {
    const { integrityHash: _, ...fields } = stored, tampered: Json = { ...fields };
    change(tampered);
    await writeFile(deliveryFile(root), JSON.stringify({ ...tampered, integrityHash: hashObject(tampered) }));
    await assert.rejects(status(root, journal, silent), (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
  }
});

test("the production reader asks Circle's pinned origin for the burn's messages and passes a non-200 answer through", async () => {
  const requests: unknown[][] = [];
  const answers = [{ status: 200, body: JSON.stringify(IRIS) }, { status: 404, body: "{\"error\":\"Message not found\"}" }, { status: 200, body: "<html>" }];
  const port = circleSolanaDeliveryReader(silent.solana, { async request(...args: unknown[]) { requests.push(args); return answers.shift()!; } } as never);
  const hash = `0x${H("ab")}`.slice(0, 66);
  assert.deepEqual(await port.issuerMessages(hash), { status: 200, body: IRIS });
  assert.deepEqual(await port.issuerMessages(hash), { status: 404, body: null });
  await assert.rejects(port.issuerMessages(hash), (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_PROTOCOL");
  await assert.rejects(port.issuerMessages("0x12"), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL");
  assert.deepEqual(requests[0], [`https://iris-api.circle.com/v2/messages/6?transactionHash=${hash}`, "GET", null, 1024 * 1024, "APN_HTTP_CONFIG"]);
  assert.equal(requests.length, 3);
});
