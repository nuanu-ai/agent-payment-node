/**
 * Delivery of a Circle CCTP V2 Base USDC to Solana burn. Circle's forwarding service receives the message on Solana; APN
 * reads Circle's public message for the burn, then the Solana transaction it names at the finalized commitment, and records
 * that transaction once beside the journal when the chain itself proves it: it consumed this message's nonce in
 * MessageTransmitterV2 and credited the journal's recipient token account with the burned USDC minus Circle's executed fee.
 */
import { address, getProgramDerivedAddress } from "@solana/kit";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { SOLANA_USDC } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { assertSolanaNetwork, protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaSignature, type SolanaRpcPort } from "../solana/rpc.js";
import type { CircleSourceProof } from "./circle-v2-source-proof.js";
import { burnPrincipal } from "./circle-v2-source-usage.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
import { BridgeHttps } from "./https.js";

export const CIRCLE_SOLANA_DELIVERY_SCHEMA = "apn.circle-v2-solana-delivery.v1";
/** Circle's CCTP V2 message transmitter on Solana mainnet; a received message's nonce account is its PDA ["used_nonce", nonce]. */
export const CIRCLE_SOLANA_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_DOMAIN = "6", SOLANA_DOMAIN = "5";
const UINT = /^(?:0|[1-9][0-9]*)$/u, NONCE = /^0x[0-9a-f]{64}$/u;

export interface CircleSolanaDelivery {
  readonly schemaVersion: typeof CIRCLE_SOLANA_DELIVERY_SCHEMA; readonly operationId: string; readonly profileHash: string;
  readonly sourceTransactionHash: string; readonly eventNonce: string; readonly recipientOwner: string; readonly recipientAta: string;
  readonly burnAtomic: string; readonly feeExecutedAtomic: string; readonly mintedAtomic: string;
  readonly solanaSignature: string; readonly slotAtomic: string; readonly observedAt: string; readonly integrityHash: string;
}
const DELIVERY_KEYS = ["burnAtomic", "eventNonce", "feeExecutedAtomic", "integrityHash", "mintedAtomic", "observedAt", "operationId",
  "profileHash", "recipientAta", "recipientOwner", "schemaVersion", "slotAtomic", "solanaSignature", "sourceTransactionHash"];

/** The two public reads of the destination: Circle's issuer API and a Solana mainnet RPC. */
export interface CircleSolanaDeliveryReader {
  /** `GET https://iris-api.circle.com/v2/messages/6?transactionHash=<hash>`; `body` is the parsed JSON of a 200 answer. */
  issuerMessages(sourceTransactionHash: string): Promise<{ readonly status: number; readonly body: unknown }>;
  /** Only an explicitly configured `APN_SOLANA_RPC_URL`; null without it (no default Solana endpoint proves a delivery). */
  readonly solana: SolanaRpcPort | null;
}
export const CIRCLE_SOLANA_RPC_ACTION = "Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.";

/** Production reader: the pinned Circle origin over the bridge HTTPS transport, and the explicitly configured Solana RPC. */
export function circleSolanaDeliveryReader(solana: SolanaRpcPort | null, https: Pick<BridgeHttps, "request"> = new BridgeHttps()): CircleSolanaDeliveryReader {
  return { solana, async issuerMessages(sourceTransactionHash) {
    if (!/^0x[0-9a-f]{64}$/u.test(sourceTransactionHash)) throw new ApnError("APN_INTERNAL", "A Circle burn hash is not a transaction hash.");
    const response = await https.request(`https://iris-api.circle.com/v2/messages/${BASE_DOMAIN}?transactionHash=${sourceTransactionHash}`,
      "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
    if (response.status !== 200) return { status: response.status, body: null };
    try { return { status: 200, body: JSON.parse(response.body) as unknown }; } catch { return issuerFailure(); }
  } };
}

export type CircleSolanaDeliveryState = "delivered" | "awaiting_issuer_message" | "awaiting_attestation" | "awaiting_forward" |
  "awaiting_solana_rpc" | "awaiting_solana_finality";
export interface CircleSolanaDeliveryView {
  readonly state: CircleSolanaDeliveryState;
  /** Circle's reported forwarding state while it has not named a finalized Solana transaction; null once delivered. */
  readonly forwardState: string | null;
  readonly proof: CircleSolanaDelivery | null;
  readonly waitingFor: string | null;
  /** True only when this call read the chain and recorded the proof. */
  readonly recorded: boolean;
}

/** `non-evm-source-journals/<profileHash>/<operationId>.solana-delivery.json`: create-only, never a record name. */
export class CircleSolanaDeliveryStore extends SecureStateStore {
  private path(journal: NonEvmSourceJournal): string {
    stateIdentifier(journal.profileHash, "Circle delivery profile"); stateIdentifier(journal.operationId, "Circle delivery operation");
    return `non-evm-source-journals/${journal.profileHash}/${journal.operationId}.solana-delivery.json`;
  }
  async load(journal: NonEvmSourceJournal): Promise<CircleSolanaDelivery | null> {
    const value = await this.readJson(this.path(journal));
    return value === null ? null : validateDelivery(value, journal);
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
 * issuer read and, once Circle names a forwarding transaction, the Solana genesis and that transaction at `finalized`.
 */
export async function circleSolanaDelivery(root: string, journal: NonEvmSourceJournal, source: CircleSourceProof,
  reader: CircleSolanaDeliveryReader | undefined, now: () => number): Promise<CircleSolanaDeliveryView> {
  if (source.status !== "success") throw new ApnError("APN_INTERNAL", "A reverted Circle burn has no delivery.");
  const store = new CircleSolanaDeliveryStore(root), existing = await store.load(journal);
  if (existing !== null) return { state: "delivered", forwardState: null, proof: existing, waitingFor: null, recorded: false };
  if (reader === undefined) {
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This runtime has no Circle issuer and Solana readers for the burn's delivery.");
  }
  const hash = source.transactionHash;
  const waiting = (state: CircleSolanaDeliveryState, forwardState: string | null, waitingFor: string): CircleSolanaDeliveryView =>
    ({ state, forwardState, proof: null, waitingFor, recorded: false });
  const answer = await reader.issuerMessages(hash);
  if (answer.status === 404) return waiting("awaiting_issuer_message", null, `Circle to publish the message of burn ${hash}`);
  if (answer.status !== 200) {
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Circle issuer API response is unavailable.",
      { reason: "issuer_http_status", httpStatus: answer.status, nextActions: [] });
  }
  const message = boundMessage(answer.body, journal);
  if (message === null) return waiting("awaiting_issuer_message", null, `Circle to publish the message of burn ${hash}`);
  if (message.status !== "complete") {
    return waiting("awaiting_attestation", message.forwardState, `Circle to attest the message of burn ${hash} (status ${message.status})`);
  }
  if (message.forwardState !== "COMPLETE" || message.forwardTxHash === null) {
    return waiting("awaiting_forward", message.forwardState,
      `Circle's forwarding service to receive the message on Solana (forwardState ${message.forwardState ?? "none"})`);
  }
  if (reader.solana === null) {
    return waiting("awaiting_solana_rpc", message.forwardState, `APN_SOLANA_RPC_URL to read the Solana transaction ${message.forwardTxHash}`);
  }
  const received = await solanaReceipt(reader.solana, journal, message);
  if (received === null) {
    return waiting("awaiting_solana_finality", message.forwardState, `the Solana transaction ${message.forwardTxHash} to be finalized`);
  }
  const fields: Omit<CircleSolanaDelivery, "integrityHash"> = { schemaVersion: CIRCLE_SOLANA_DELIVERY_SCHEMA, operationId: journal.operationId,
    profileHash: journal.profileHash, sourceTransactionHash: hash, eventNonce: message.eventNonce,
    recipientOwner: journal.admissionProof.recipientOwner, recipientAta: journal.admissionProof.recipientAta, burnAtomic: message.amount,
    feeExecutedAtomic: message.feeExecuted, mintedAtomic: (BigInt(message.amount) - BigInt(message.feeExecuted)).toString(),
    solanaSignature: message.forwardTxHash, slotAtomic: received.slot.toString(), observedAt: new Date(now()).toISOString() };
  const proof = await store.create(journal, Object.freeze({ ...fields, integrityHash: hashObject(fields) }));
  return { state: "delivered", forwardState: null, proof, waitingFor: null, recorded: true };
}

interface IssuerMessage {
  readonly status: string; readonly eventNonce: string; readonly amount: string; readonly feeExecuted: string;
  readonly forwardState: string | null; readonly forwardTxHash: string | null;
}
function issuerFailure(): never {
  throw new ApnError("APN_PROVIDER_PROTOCOL", "Circle issuer API answered a message that is not this burn's.", { reason: "circle_delivery_message" });
}
function text(value: unknown, maximum = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) issuerFailure();
  return value;
}
function optionalText(value: unknown): string | null { return value === null || value === undefined ? null : text(value); }

/** The one message of this burn: Base to Solana, Base USDC, the journal's messenger, recipient account and principal. */
function boundMessage(body: unknown, journal: NonEvmSourceJournal): IssuerMessage | null {
  if (!isPlainRecord(body) || !Array.isArray(body.messages) || body.messages.length > 8) issuerFailure();
  const principal = burnPrincipal(journal);
  if (principal === null) throw new ApnError("APN_STATE_CORRUPT", "The Circle journal does not carry its burn principal.");
  const bound = body.messages.filter(value => {
    const decoded = isPlainRecord(value) && isPlainRecord(value.decodedMessage) ? value.decodedMessage : null;
    const message = decoded !== null && isPlainRecord(decoded.decodedMessageBody) ? decoded.decodedMessageBody : null;
    return message !== null && decoded!.sourceDomain === BASE_DOMAIN && decoded!.destinationDomain === SOLANA_DOMAIN &&
      typeof message.burnToken === "string" && message.burnToken.toLowerCase() === BASE_USDC &&
      typeof message.messageSender === "string" && message.messageSender.toLowerCase() === journal.sourceCall.to.toLowerCase() &&
      message.mintRecipient === journal.admissionProof.recipientAta && message.amount === principal;
  }) as Record<string, unknown>[];
  if (bound.length === 0) return null;
  if (bound.length !== 1) issuerFailure();
  const value = bound[0]!, body0 = (value.decodedMessage as Record<string, unknown>).decodedMessageBody as Record<string, unknown>;
  const eventNonce = text(value.eventNonce).toLowerCase(), feeExecuted = text(body0.feeExecuted);
  if (!NONCE.test(eventNonce) || !UINT.test(feeExecuted) || BigInt(feeExecuted) >= BigInt(principal)) issuerFailure();
  const forwardTxHash = optionalText(value.forwardTxHash);
  return { status: text(value.status, 32), eventNonce, amount: principal, feeExecuted, forwardState: optionalText(value.forwardState),
    forwardTxHash: forwardTxHash === null ? null : solanaSignature(forwardTxHash) };
}

/**
 * The named Solana transaction at `finalized`, or null while the node does not return it there. It must have succeeded,
 * called the message transmitter at the top level, written this message's used-nonce account, and moved exactly the
 * minted amount of USDC into the journal's recipient token account owned by the journal's recipient.
 */
async function solanaReceipt(rpc: SolanaRpcPort, journal: NonEvmSourceJournal, message: IssuerMessage): Promise<{ readonly slot: bigint } | null> {
  await assertSolanaNetwork(rpc);
  const signature = message.forwardTxHash!;
  const value = await rpc.call("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (value === null) return null;
  const tx = rpcRecord(value), meta = rpcRecord(tx.meta), transaction = rpcRecord(tx.transaction), body = rpcRecord(transaction.message);
  const slot = rpcAtomic(tx.slot);
  if (meta.err !== null || rpcArray(transaction.signatures, 8)[0] !== signature) protocolFailure();
  const entries = rpcArray(body.accountKeys, 64).map(rpcRecord), keys = entries.map(entry => entry.pubkey);
  if (keys.some(key => typeof key !== "string") || new Set(keys).size !== keys.length) protocolFailure();
  if (!rpcArray(body.instructions, 16).map(rpcRecord).some(instruction => instruction.programId === CIRCLE_SOLANA_MESSAGE_TRANSMITTER)) protocolFailure();
  const [usedNonce] = await getProgramDerivedAddress({ programAddress: address(CIRCLE_SOLANA_MESSAGE_TRANSMITTER),
    seeds: ["used_nonce", Buffer.from(message.eventNonce.slice(2), "hex")] });
  const ata = journal.admissionProof.recipientAta, index = keys.indexOf(ata);
  if (!keys.includes(usedNonce) || index < 0 || entries[index]!.writable !== true) protocolFailure();
  const balance = (list: unknown, required: boolean): bigint => {
    // The production RPC parses every JSON integer as a bigint.
    const rows = rpcArray(list, 64).map(rpcRecord).filter(row => rpcAtomic(row.accountIndex) === BigInt(index));
    if (rows.length === 0 && !required) return 0n;
    const row = rows.length === 1 ? rows[0]! : protocolFailure(), amount = rpcRecord(row.uiTokenAmount).amount;
    if (row.mint !== SOLANA_USDC || row.owner !== journal.admissionProof.recipientOwner || typeof amount !== "string" || !UINT.test(amount)) protocolFailure();
    return BigInt(amount);
  };
  const minted = BigInt(message.amount) - BigInt(message.feeExecuted);
  if (balance(meta.postTokenBalances, true) - balance(meta.preTokenBalances, false) !== minted) protocolFailure();
  return { slot };
}

function deliveryCorrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "The delivery proof of a Circle burn is not the one its journal allows.", { reason: "circle_delivery_binding" });
}
function validateDelivery(value: unknown, journal: NonEvmSourceJournal): CircleSolanaDelivery {
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(DELIVERY_KEYS)) deliveryCorrupt();
  const proof = value as unknown as CircleSolanaDelivery, { integrityHash, ...fields } = proof;
  const numbers = [proof.burnAtomic, proof.feeExecutedAtomic, proof.mintedAtomic, proof.slotAtomic];
  if (proof.schemaVersion !== CIRCLE_SOLANA_DELIVERY_SCHEMA || hashObject(fields) !== integrityHash || proof.operationId !== journal.operationId ||
    proof.profileHash !== journal.profileHash || proof.sourceTransactionHash !== journal.transactionHash ||
    proof.recipientOwner !== journal.admissionProof.recipientOwner || proof.recipientAta !== journal.admissionProof.recipientAta ||
    numbers.some(number => typeof number !== "string" || !UINT.test(number)) || proof.burnAtomic !== burnPrincipal(journal) ||
    BigInt(proof.feeExecutedAtomic) >= BigInt(proof.burnAtomic) ||
    BigInt(proof.mintedAtomic) !== BigInt(proof.burnAtomic) - BigInt(proof.feeExecutedAtomic) ||
    typeof proof.eventNonce !== "string" || !NONCE.test(proof.eventNonce) ||
    typeof proof.observedAt !== "string" || !Number.isFinite(Date.parse(proof.observedAt)) ||
    new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt) deliveryCorrupt();
  try { solanaSignature(proof.solanaSignature); } catch { deliveryCorrupt(); }
  return Object.freeze(proof);
}
