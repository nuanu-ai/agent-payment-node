import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBase58Encoder } from "@solana/kit";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import type { ApnError } from "../../src/errors.js";
import type { FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import type { CircleSolanaDeliveryReader } from "../../src/lifi/circle-v2-solana-delivery.js";
import { CIRCLE_SOURCE_PROOF_SCHEMA, CircleSourceProofStore, circleSourceStatus } from "../../src/lifi/circle-v2-source-proof.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "../../src/lifi/non-evm-source-journal.js";
import { temporaryState } from "./helpers.js";

/**
 * Two real Circle Base to Solana deliveries (tests/fixtures/circle-solana-delivery) and the journals, source proofs and
 * read ports the delivery tests build around them. A journal is signed with a public test key; its burn receipt is the
 * real one placed at the journal's own hash and at the block its source proof records.
 */
export type Json = Record<string, any>;
export const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), H = (c: string) => c.repeat(64);
export const BURN = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
export const fixture = async (name: string, parse: (text: string) => unknown): Promise<Json> =>
  parse(await readFile(join(process.cwd(), `tests/fixtures/circle-solana-delivery/${name}.json`), "utf8")) as Json;
/** Two real deliveries: to an existing token account, and one created by the receiving transaction (read without bigints). */
export const SMALL = { amount: 170_000n, owner: "3C2rcV1uQpFX79cY7ALfKeJiD7JiLQFvSB2kZjjE11Yv", ata: "BJRwCA3CXCoPqBAutrJvcHoRgQmyfJv6xo7bupwubgqy",
  signature: "2M7FC4TwiVmJ9YKZ4nAiWVjffeZdUoow1guXk9tqjZAs3dKXVQwZtXuogY65rYffwBd8Led6nSHAvJ8P1opt5ppV",
  iris: await fixture("iris-message-170000", JSON.parse), receive: await fixture("solana-receive-170000", parseJsonWithBigInts),
  receivers: await fixture("used-nonce-signatures-170000", parseJsonWithBigInts), receipt: await fixture("base-receipt-170000", JSON.parse) };
export const LARGE = { amount: 1_000_000n, owner: "2i72eWcpDU862RVwGaGCos2PHoQgYTphjfJpxcv5W1EJ", ata: "gYgbhjCMBwLKvFa4Tn2dDW3dRY2a4CwPtkT27feuVr7",
  signature: "5kbzTzCCWMmeZ48a4Mp5rmMZRaZponimWj8UD7Ca1stBsRCat7RfpxYPr3FbMiPMAkRHNytqhz1SKWpqmqZUSmrg",
  iris: await fixture("iris-message-1000000", JSON.parse), receive: await fixture("solana-receive-1000000", JSON.parse), receivers: [] as Json,
  receipt: await fixture("base-receipt-1000000", JSON.parse) };
export type Case = typeof SMALL;
export const copy = <T>(value: T): T => structuredClone(value);
export const at = (ms: number) => new Date(Date.now() + ms).toISOString();
export const STATUS = `apn operation status --operation ${H("b")}`;

/** A burn to the case's recipient, sent once and left `submitted_pending`; its calldata names the recipient's token account. */
export async function burned(root: string, burn: Case, operationId = H("b"), nonce = 7): Promise<NonEvmSourceJournal> {
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
export async function recorded(root: string, journal: NonEvmSourceJournal, status: "success" | "reverted" = "success"): Promise<void> {
  const fields = { schemaVersion: CIRCLE_SOURCE_PROOF_SCHEMA as typeof CIRCLE_SOURCE_PROOF_SCHEMA, operationId: journal.operationId,
    profileHash: journal.profileHash, chainId: 8453 as const, payer: journal.sourceCall.from, to: journal.sourceCall.to,
    transactionHash: journal.transactionHash!, nonceAtomic: journal.nonceAtomic!, status, blockNumberAtomic: "100",
    blockHash: `0x${H("e")}`, blockTag: "finalized" as const, finalizedBlockNumberAtomic: "100", observedAt: at(5) };
  await new CircleSourceProofStore(root).create(journal, { ...fields, integrityHash: hashObject(fields) });
}
/** The case's real Base burn receipt, as the journal's own transaction in the block its source proof recorded. */
export function sourceReceipt(burn: Case, journal: NonEvmSourceJournal): Json {
  const receipt = copy(burn.receipt), place = (value: Json) => { value.transactionHash = journal.transactionHash; value.blockHash = `0x${H("e")}`; };
  place(receipt); (receipt.logs as Json[]).forEach(place);
  return receipt;
}
/** Base at the finalized tag: the residual allowance and, until the delivery is recorded, the burn's receipt. */
export const base = (receipt?: unknown): ((chainId: number) => FinalizedChainRead) => () => ({ async call(method) {
  if (method === "eth_getTransactionReceipt" && receipt !== undefined) return copy(receipt);
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_getBlockByNumber") return { number: "0x64", hash: `0x${H("f")}` };
  if (method === "eth_call") return `0x${"0".repeat(64)}`;
  throw new Error(`unexpected ${method}`);
} });
export interface Answers { iris?: { status: number; body: unknown }; transaction?: unknown; transactions?: Record<string, unknown>; receivers?: unknown; solana?: null; fail?: ApnError }
/** Circle and Solana as the case's fixtures answer them, each read logged. */
export function reader(burn: Case, calls: string[], answers: Answers = {}): CircleSolanaDeliveryReader {
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
export const silent = { solana: { originHash: "none", async call() { throw new Error("no Solana read expected"); } },
  async issuerMessages() { throw new Error("no issuer read expected"); } } satisfies CircleSolanaDeliveryReader;
export const deliveryFile = (root: string, id = H("b")) => join(root, "non-evm-source-journals", H("a"), `${id}.solana-delivery-v2.json`);
export const absent = async (root: string) => assert.equal(await readFile(deliveryFile(root)).then(() => true, () => false), false);
export async function setup(t: import("node:test").TestContext, burn: Case = SMALL) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root, burn); await recorded(temporary.root, journal);
  return { root: temporary.root, journal };
}
export const status = (root: string, journal: NonEvmSourceJournal, delivery?: CircleSolanaDeliveryReader, burn: Case = SMALL,
  receipt: unknown = sourceReceipt(burn, journal)) => circleSourceStatus(root, journal, base(receipt), () => Date.now(), false, delivery);
/** Circle's message with its decoded fields or its attested bytes changed. */
export function iris(burn: Case, change: (message: Json, bytes: Buffer, body: Json) => void) {
  const body = copy(burn.iris), message = body.messages[0], bytes = Buffer.from(message.message.slice(2), "hex");
  change(message, bytes, body);
  if (typeof message.message === "string" && message.message.length > 2) message.message = `0x${bytes.toString("hex")}`;
  return { status: 200, body };
}
export const uint256 = (bytes: Buffer, offset: number, value: bigint) => { Buffer.from(value.toString(16).padStart(64, "0"), "hex").copy(bytes, offset); };
