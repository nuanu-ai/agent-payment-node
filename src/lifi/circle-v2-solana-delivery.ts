/**
 * Delivery of a Circle CCTP V2 Base USDC to Solana burn. Circle's forwarding service (or any payer) receives the message
 * on Solana; APN only reads. Circle's issuer API locates the attested message and the receiving transaction; the record is
 * proven from the chain: the finalized transaction carries those exact message bytes to MessageTransmitterV2, writes the
 * message's used-nonce account and credits the journal's recipient token account with the principal minus the executed
 * fee. Each message proves one operation only. A read that fails is shown with its reason and never fails the status.
 */
import { address, getProgramDerivedAddress } from "@solana/kit";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { SOLANA_USDC } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { assertSolanaNetworkValue, rpcArray, rpcAtomic, rpcRecord, solanaSignature, type SolanaReadMethod } from "../solana/rpc.js";
import { circleBurnTerms, decodeCctpBurnMessage, messageBindsBurn, receiveMessageBytes, type CctpBurnMessage,
  type CircleBurnTerms } from "./circle-v2-cctp-message.js";
import type { CircleSourceProof } from "./circle-v2-source-proof.js";
import { BridgeHttps } from "./https.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";

export const CIRCLE_SOLANA_DELIVERY_SCHEMA = "apn.circle-v2-solana-delivery.v1";
const CLAIM_SCHEMA = "apn.circle-v2-solana-delivery-claim.v1";
/** Circle's CCTP V2 message transmitter on Solana mainnet; a received message's nonce account is its PDA ["used_nonce", nonce]. */
export const CIRCLE_SOLANA_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export const CIRCLE_SOLANA_RPC_ACTION = "Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.";
const NONCE_PAGE = 16;
const UINT = /^(?:0|[1-9][0-9]*)$/u, NONCE = /^0x[0-9a-f]{64}$/u, SHA = /^[0-9a-f]{64}$/u;
const UNREAD = new Set(["APN_PROVIDER_UNAVAILABLE", "APN_PROVIDER_PROTOCOL", "APN_RPC_PROTOCOL", "APN_RPC_RATE_LIMITED", "APN_RPC_AMBIGUOUS",
  "APN_RPC_CONFIG", "APN_RPC_BUDGET_EXCEEDED", "APN_HTTP_CONFIG", "APN_HTTP_PROTOCOL", "APN_HTTP_AMBIGUOUS", "APN_CHAIN_MISMATCH"]);

export interface CircleSolanaDelivery {
  readonly schemaVersion: typeof CIRCLE_SOLANA_DELIVERY_SCHEMA; readonly operationId: string; readonly profileHash: string;
  readonly sourceTransactionHash: string; readonly eventNonce: string; readonly messageSha256: string;
  readonly recipientOwner: string; readonly recipientAta: string; readonly burnAtomic: string; readonly maxFeeAtomic: string;
  readonly feeExecutedAtomic: string; readonly mintedAtomic: string; readonly solanaSignature: string; readonly slotAtomic: string;
  readonly observedAt: string; readonly integrityHash: string;
}
const DELIVERY_KEYS = ["burnAtomic", "eventNonce", "feeExecutedAtomic", "integrityHash", "maxFeeAtomic", "messageSha256", "mintedAtomic",
  "observedAt", "operationId", "profileHash", "recipientAta", "recipientOwner", "schemaVersion", "slotAtomic", "solanaSignature",
  "sourceTransactionHash"];

/** Solana reads only: no method that sends can be called through it. */
export interface SolanaReadPort { readonly originHash: string; call(method: SolanaReadMethod, params: readonly unknown[]): Promise<unknown> }
/** The two public reads of the destination: Circle's issuer API and a Solana mainnet RPC. */
export interface CircleSolanaDeliveryReader {
  /** `GET https://iris-api.circle.com/v2/messages/6?transactionHash=<hash>`; `body` is the parsed JSON of a 200 answer. */
  issuerMessages(sourceTransactionHash: string): Promise<{ readonly status: number; readonly body: unknown }>;
  /** Only an explicitly configured `APN_SOLANA_RPC_URL`; null without it (no default Solana endpoint proves a delivery). */
  readonly solana: SolanaReadPort | null;
}

/** Production reader: the pinned Circle origin over the bridge HTTPS transport, and the explicitly configured Solana RPC. */
export function circleSolanaDeliveryReader(solana: SolanaReadPort | null, https: Pick<BridgeHttps, "request"> = new BridgeHttps()): CircleSolanaDeliveryReader {
  return { solana, async issuerMessages(sourceTransactionHash) {
    if (!/^0x[0-9a-f]{64}$/u.test(sourceTransactionHash)) throw new ApnError("APN_INTERNAL", "A Circle burn hash is not a transaction hash.");
    const response = await https.request(`https://iris-api.circle.com/v2/messages/6?transactionHash=${sourceTransactionHash}`,
      "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
    if (response.status !== 200) return { status: response.status, body: null };
    try { return { status: 200, body: JSON.parse(response.body) as unknown }; } catch { return issuerFailure("circle_delivery_json"); }
  } };
}

export type CircleSolanaDeliveryState = "delivered" | "awaiting_issuer_message" | "awaiting_attestation" | "awaiting_forward" |
  "forward_failed" | "awaiting_solana_rpc" | "awaiting_solana_finality" | "unread";
export interface CircleSolanaDeliveryView {
  readonly state: CircleSolanaDeliveryState;
  /** Circle's reported forwarding state while no receipt is recorded; null once delivered or when unknown. */
  readonly forwardState: string | null;
  readonly proof: CircleSolanaDelivery | null;
  readonly waitingFor: string | null;
  /** Actions of the delivery itself, before the status command (`unread`: the failed read's own next actions). */
  readonly nextActions: readonly string[];
  readonly unreadReason?: string;
  /** True only when this call read the chain and recorded the proof. */
  readonly recorded: boolean;
}

/** `non-evm-source-journals/<profileHash>/<operationId>.solana-delivery.json` and one claim per message nonce. */
export class CircleSolanaDeliveryStore extends SecureStateStore {
  private path(journal: NonEvmSourceJournal): string {
    stateIdentifier(journal.profileHash, "Circle delivery profile"); stateIdentifier(journal.operationId, "Circle delivery operation");
    return `non-evm-source-journals/${journal.profileHash}/${journal.operationId}.solana-delivery.json`;
  }
  async load(journal: NonEvmSourceJournal): Promise<CircleSolanaDelivery | null> {
    const value = await this.readJson(this.path(journal));
    return value === null ? null : validateDelivery(value, journal);
  }
  /** The message's one operation: a create-only claim; a message another operation claimed proves nothing here. */
  async claim(journal: NonEvmSourceJournal, nonce: string, signature: string): Promise<void> {
    const claim = { schemaVersion: CLAIM_SCHEMA, eventNonce: nonce, operationId: journal.operationId, profileHash: journal.profileHash, solanaSignature: signature };
    const path = `circle-solana-delivery-claims/${nonce.slice(2)}.json`;
    await this.ensureDirectory("circle-solana-delivery-claims");
    try { await this.writeJson(path, claim, true); return; }
    catch (error) { if (!(error instanceof ApnError) || error.message !== "State target is already occupied.") throw error; }
    if (canonicalJson(await this.readJson(path)) !== canonicalJson(claim)) {
      throw new ApnError("APN_PROVIDER_PROTOCOL", "Another local operation already holds this Circle message's Solana receipt.",
        { reason: "circle_delivery_message_claimed" });
    }
  }
  /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
  async create(journal: NonEvmSourceJournal, delivery: CircleSolanaDelivery): Promise<CircleSolanaDelivery> {
    validateDelivery(delivery, journal);
    try { await this.writeJson(this.path(journal), delivery, true); }
    catch (error) {
      if (!(error instanceof ApnError) || error.message !== "State target is already occupied.") throw error;
      const existing = await this.load(journal);
      if (existing === null) throw error;
      return existing;
    }
    return delivery;
  }
}

/**
 * The delivery of a burn whose finalized receipt succeeded. A recorded proof is returned without any read; otherwise one
 * issuer read and, once the message is attested, Solana reads at `finalized`. A failed read becomes `unread` with its reason.
 */
export async function circleSolanaDelivery(root: string, journal: NonEvmSourceJournal, source: CircleSourceProof,
  reader: CircleSolanaDeliveryReader | undefined, now: () => number): Promise<CircleSolanaDeliveryView> {
  if (source.status !== "success") throw new ApnError("APN_INTERNAL", "A reverted Circle burn has no delivery.");
  const store = new CircleSolanaDeliveryStore(root), existing = await store.load(journal);
  if (existing !== null) return { state: "delivered", forwardState: null, proof: existing, waitingFor: null, nextActions: [], recorded: false };
  if (reader === undefined) {
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This runtime has no Circle issuer and Solana readers for the burn's delivery.");
  }
  try { return await observe(store, journal, source.transactionHash, reader, now); }
  catch (error) {
    if (!(error instanceof ApnError) || !UNREAD.has(error.code)) throw error;
    const reason = typeof error.details?.reason === "string" ? ` (${error.details.reason})` : "";
    const unreadReason = `${error.code}: ${error.message}${reason}`;
    return { state: "unread", forwardState: null, proof: null, waitingFor: `a delivery read that succeeds; the last one failed: ${unreadReason}`,
      nextActions: stringList(error.details?.nextActions), unreadReason, recorded: false };
  }
}

async function observe(store: CircleSolanaDeliveryStore, journal: NonEvmSourceJournal, hash: string,
  reader: CircleSolanaDeliveryReader, now: () => number): Promise<CircleSolanaDeliveryView> {
  const waiting = (state: CircleSolanaDeliveryState, forwardState: string | null, waitingFor: string, nextActions: readonly string[] = []) =>
    ({ state, forwardState, proof: null, waitingFor, nextActions, recorded: false });
  const answer = await reader.issuerMessages(hash);
  if (answer.status === 404) return waiting("awaiting_issuer_message", null, `Circle to publish the message of burn ${hash}`);
  if (answer.status !== 200) unavailable(answer.status);
  // The service built the calldata's recipient from the admitted token account; a journal where they differ binds nothing.
  const terms = circleBurnTerms(journal);
  if (terms === null) throw new ApnError("APN_STATE_CORRUPT", "The Circle journal's burn call does not match its recipient.", { reason: "circle_delivery_terms" });
  const published = issuerMessage(answer.body, terms);
  if (published === null) return waiting("awaiting_issuer_message", null, `Circle to publish the message of burn ${hash}`);
  if (published.status !== "complete") {
    return waiting("awaiting_attestation", published.forwardState, `Circle to attest the message of burn ${hash} (status ${published.status})`);
  }
  const message = attested(published, terms), forwardState = published.forwardState;
  const notForwarded = (solana: boolean) => forwardState === "FAILED"
    ? waiting("forward_failed", forwardState, "the attested message to be received on Solana; Circle's forwarding failed", [
      `Any Solana payer may submit MessageTransmitterV2 receive_message with the message and attestation of https://iris-api.circle.com/v2/messages/6?transactionHash=${hash}; APN does not sign on Solana for this route. Then rerun the same command.`,
      ...solana ? [] : [CIRCLE_SOLANA_RPC_ACTION]])
    : waiting("awaiting_forward", forwardState, `Circle's forwarding service to receive the message on Solana (forwardState ${forwardState ?? "none"})`);
  if (reader.solana === null) {
    return published.forwardTxHash === null ? notForwarded(false)
      : waiting("awaiting_solana_rpc", forwardState, `APN_SOLANA_RPC_URL to read the Solana transaction ${published.forwardTxHash}`, [CIRCLE_SOLANA_RPC_ACTION]);
  }
  const rpc = reader.solana;
  assertSolanaNetworkValue(await rpc.call("getGenesisHash", []));
  const [usedNonce] = await getProgramDerivedAddress({ programAddress: address(CIRCLE_SOLANA_MESSAGE_TRANSMITTER),
    seeds: ["used_nonce", Buffer.from(message.nonce.slice(2), "hex")] });
  let signature: string, slot: bigint | null;
  if (published.forwardTxHash !== null) {
    signature = published.forwardTxHash;
    slot = await solanaReceipt(rpc, terms, message, usedNonce, signature);
    if (slot === null) {
      return waiting("awaiting_solana_finality", forwardState,
        `the Solana transaction ${signature} at finalized on APN_SOLANA_RPC_URL (an RPC without that history returns none)`);
    }
  } else {
    // Without Circle's forwarding transaction, a message received by anyone else is found through its used-nonce account.
    const found = await nonceReceiver(rpc, terms, message, usedNonce);
    if (found === null) return notForwarded(true);
    ({ signature, slot } = found);
  }
  await store.claim(journal, message.nonce, signature);
  const fields: Omit<CircleSolanaDelivery, "integrityHash"> = { schemaVersion: CIRCLE_SOLANA_DELIVERY_SCHEMA, operationId: journal.operationId,
    profileHash: journal.profileHash, sourceTransactionHash: hash, eventNonce: message.nonce, messageSha256: message.sha256,
    recipientOwner: terms.recipientOwner, recipientAta: terms.recipientAta, burnAtomic: message.amount.toString(),
    maxFeeAtomic: message.maxFee.toString(), feeExecutedAtomic: message.feeExecuted.toString(),
    mintedAtomic: (message.amount - message.feeExecuted).toString(), solanaSignature: signature, slotAtomic: slot.toString(),
    observedAt: new Date(now()).toISOString() };
  const proof = await store.create(journal, Object.freeze({ ...fields, integrityHash: hashObject(fields) }));
  return { state: "delivered", forwardState: null, proof, waitingFor: null, nextActions: [], recorded: true };
}

const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : [];

interface IssuerMessage { readonly raw: Record<string, unknown>; readonly status: string; readonly forwardState: string | null; readonly forwardTxHash: string | null }
function issuerFailure(reason: string): never {
  throw new ApnError("APN_PROVIDER_PROTOCOL", "Circle issuer API answered a message that is not this burn's.", { reason });
}
function unavailable(status: number): never {
  throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Circle issuer API response is unavailable.", { reason: "issuer_http_status", httpStatus: status, nextActions: [] });
}
function text(value: unknown, reason: string, maximum = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) issuerFailure(reason);
  return value;
}
const optional = (value: unknown, reason: string) => value === null || value === undefined ? null : text(value, reason);

/** This burn's one message, chosen by its decoded fields (a pending message may still lack its nonce and fee). */
function issuerMessage(body: unknown, terms: CircleBurnTerms): IssuerMessage | null {
  if (!isPlainRecord(body) || !Array.isArray(body.messages) || body.messages.length > 8) issuerFailure("circle_delivery_messages");
  const ours = body.messages.filter((value): value is Record<string, unknown> => {
    const decoded = isPlainRecord(value) && isPlainRecord(value.decodedMessage) ? value.decodedMessage : null;
    const burn = decoded !== null && isPlainRecord(decoded.decodedMessageBody) ? decoded.decodedMessageBody : null;
    return burn !== null && decoded!.sourceDomain === "6" && decoded!.destinationDomain === "5" &&
      typeof burn.messageSender === "string" && burn.messageSender.toLowerCase() === terms.messageSender &&
      burn.mintRecipient === terms.recipientAta && burn.amount === terms.amount.toString();
  });
  if (ours.length === 0) return null;
  if (ours.length !== 1) issuerFailure("circle_delivery_messages");
  const raw = ours[0]!, forwardTxHash = optional(raw.forwardTxHash, "circle_delivery_forward_tx");
  if (forwardTxHash !== null) { try { solanaSignature(forwardTxHash); } catch { issuerFailure("circle_delivery_forward_tx"); } }
  return { raw, status: text(raw.status, "circle_delivery_status", 32), forwardState: optional(raw.forwardState, "circle_delivery_forward_state"), forwardTxHash };
}
/** The attested bytes themselves, bound to the burn; the decoded fields Circle serves beside them must agree. */
function attested(published: IssuerMessage, terms: CircleBurnTerms): CctpBurnMessage {
  const hex = text(published.raw.message, "circle_delivery_message_bytes", 8194);
  const message = /^0x(?:[0-9a-f]{2})+$/u.test(hex) ? decodeCctpBurnMessage(Buffer.from(hex.slice(2), "hex")) : null;
  if (message === null || !messageBindsBurn(message, terms)) issuerFailure("circle_delivery_message_bytes");
  if (typeof published.raw.eventNonce !== "string" || published.raw.eventNonce.toLowerCase() !== message.nonce) issuerFailure("circle_delivery_nonce");
  return message;
}

function binding(reason: string): never {
  throw new ApnError("APN_RPC_PROTOCOL", "The Solana transaction is not this burn's receipt.", { reason });
}
/**
 * The receive among the successful finalized transactions naming the used-nonce account, oldest first. Anyone may name the
 * public account, so each is checked as a receipt and one that is not is skipped; only one transaction can receive a
 * message. A full page without a receipt is reported, never taken as "not received".
 */
async function nonceReceiver(rpc: SolanaReadPort, terms: CircleBurnTerms, message: CctpBurnMessage,
  usedNonce: string): Promise<{ readonly signature: string; readonly slot: bigint } | null> {
  const rows = rpcArray(await rpc.call("getSignaturesForAddress", [usedNonce, { commitment: "finalized", limit: NONCE_PAGE }]), NONCE_PAGE).map(rpcRecord);
  for (const signature of rows.filter(row => row.err === null).map(row => solanaSignature(row.signature)).reverse()) {
    try {
      const slot = await solanaReceipt(rpc, terms, message, usedNonce, signature);
      if (slot !== null) return { signature, slot };
    } catch (error) {
      if (!(error instanceof ApnError) || typeof error.details?.reason !== "string" || !error.details.reason.startsWith("circle_delivery_")) throw error;
    }
  }
  if (rows.length === NONCE_PAGE) binding("circle_delivery_nonce_history");
  return null;
}

/**
 * The named transaction at `finalized`, or null while the node does not return it there. It must have succeeded and carry
 * a `receive_message` of these exact bytes to the transmitter (top level or inner), write the used-nonce account and move
 * exactly the minted amount of USDC into the recipient token account owned by the recipient. Integers may be bigints.
 */
async function solanaReceipt(rpc: SolanaReadPort, terms: CircleBurnTerms, message: CctpBurnMessage, usedNonce: string,
  signature: string): Promise<bigint | null> {
  const value = await rpc.call("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (value === null) return null;
  const tx = rpcRecord(value), meta = rpcRecord(tx.meta), transaction = rpcRecord(tx.transaction), body = rpcRecord(transaction.message);
  const slot = rpcAtomic(tx.slot);
  if (meta.err !== null) binding("circle_delivery_transaction_failed");
  if (rpcArray(transaction.signatures, 16)[0] !== signature) binding("circle_delivery_signature");
  const entries = rpcArray(body.accountKeys, 256).map(rpcRecord), keys = entries.map(entry => entry.pubkey);
  if (keys.some(key => typeof key !== "string") || new Set(keys).size !== keys.length) binding("circle_delivery_accounts");
  const inner = meta.innerInstructions === null || meta.innerInstructions === undefined ? []
    : rpcArray(meta.innerInstructions, 64).flatMap(group => rpcArray(rpcRecord(group).instructions, 256));
  const receives = [...rpcArray(body.instructions, 64), ...inner].map(rpcRecord)
    .filter(instruction => instruction.programId === CIRCLE_SOLANA_MESSAGE_TRANSMITTER)
    .map(instruction => receiveMessageBytes(instruction.data));
  if (!receives.some(bytes => bytes !== null && bytes.equals(message.bytes))) binding("circle_delivery_message");
  const nonceIndex = keys.indexOf(usedNonce), index = keys.indexOf(terms.recipientAta);
  if (nonceIndex < 0 || entries[nonceIndex]!.writable !== true) binding("circle_delivery_used_nonce");
  if (index < 0 || entries[index]!.writable !== true) binding("circle_delivery_recipient");
  const balance = (list: unknown, required: boolean): bigint => {
    const rows = (list === null || list === undefined ? [] : rpcArray(list, 256)).map(rpcRecord).filter(row => rpcAtomic(row.accountIndex) === BigInt(index));
    if (rows.length === 0 && !required) return 0n;
    if (rows.length !== 1) binding("circle_delivery_balance");
    const row = rows[0]!, amount = rpcRecord(row.uiTokenAmount).amount;
    if (row.mint !== SOLANA_USDC || row.owner !== terms.recipientOwner || typeof amount !== "string" || !UINT.test(amount)) binding("circle_delivery_balance");
    return BigInt(amount);
  };
  if (balance(meta.postTokenBalances, true) - balance(meta.preTokenBalances, false) !== message.amount - message.feeExecuted) binding("circle_delivery_amount");
  return slot;
}

function deliveryCorrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "The delivery proof of a Circle burn is not the one its journal allows.", { reason: "circle_delivery_binding" });
}
function validateDelivery(value: unknown, journal: NonEvmSourceJournal): CircleSolanaDelivery {
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(DELIVERY_KEYS)) deliveryCorrupt();
  const proof = value as unknown as CircleSolanaDelivery, { integrityHash, ...fields } = proof, terms = circleBurnTerms(journal);
  const numbers = [proof.burnAtomic, proof.maxFeeAtomic, proof.feeExecutedAtomic, proof.mintedAtomic, proof.slotAtomic];
  if (terms === null || proof.schemaVersion !== CIRCLE_SOLANA_DELIVERY_SCHEMA || hashObject(fields) !== integrityHash ||
    proof.operationId !== journal.operationId || proof.profileHash !== journal.profileHash || proof.sourceTransactionHash !== journal.transactionHash ||
    proof.recipientOwner !== terms.recipientOwner || proof.recipientAta !== terms.recipientAta ||
    numbers.some(number => typeof number !== "string" || !UINT.test(number)) || BigInt(proof.burnAtomic) !== terms.amount ||
    BigInt(proof.feeExecutedAtomic) > BigInt(proof.maxFeeAtomic) || BigInt(proof.feeExecutedAtomic) >= BigInt(proof.burnAtomic) ||
    BigInt(proof.mintedAtomic) !== BigInt(proof.burnAtomic) - BigInt(proof.feeExecutedAtomic) ||
    typeof proof.eventNonce !== "string" || !NONCE.test(proof.eventNonce) || typeof proof.messageSha256 !== "string" || !SHA.test(proof.messageSha256) ||
    typeof proof.observedAt !== "string" || !Number.isFinite(Date.parse(proof.observedAt)) ||
    new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt) deliveryCorrupt();
  try { solanaSignature(proof.solanaSignature); } catch { deliveryCorrupt(); }
  return Object.freeze(proof);
}
