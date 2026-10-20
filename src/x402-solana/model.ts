import { z } from "zod";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { solanaAddress } from "../solana/rpc.js";
import { X402_SOLANA_ALLOWLIST_CHAIN, X402_SOLANA_FAMILY, X402_SOLANA_NETWORK, X402_SOLANA_SCHEMA } from "./constants.js";

export type X402SolanaState = "prepared" | "reserving" | "signed" | "exposed" | "settled" | "failed_onchain" | "expired_unlanded" |
  "failed_before_effect" | "abandoned_unknown";
/**
 * `prepared`: frozen, nothing reserved or signed. `reserving`: the lifetime is bound and the usage hold is being taken.
 * `signed`: the payer's signature exists locally and was never handed to the seller. `exposed`: the paid request was
 * started, so the facilitator may land the transaction until its lifetime ends. Every state before `exposed` ends without
 * an effect; `exposed` ends by a finalized proof (settled or failed on chain), by the chain proving the transaction can
 * no longer land, or by the owner's abandon.
 */
const EDGES: Readonly<Record<X402SolanaState, readonly X402SolanaState[]>> = {
  prepared: ["reserving", "failed_before_effect"],
  reserving: ["signed", "failed_before_effect"],
  signed: ["exposed", "failed_before_effect"],
  exposed: ["settled", "failed_onchain", "expired_unlanded", "abandoned_unknown"],
  settled: [], failed_onchain: [], expired_unlanded: [], failed_before_effect: [], abandoned_unknown: [],
};
export const X402_SOLANA_STATES = Object.keys(EDGES) as readonly X402SolanaState[];
export const X402_SOLANA_TERMINAL_STATES: readonly X402SolanaState[] = X402_SOLANA_STATES.filter((state) => EDGES[state].length === 0);

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const iso = z.string().refine((value) => { const at = Date.parse(value); return Number.isFinite(at) && new Date(at).toISOString() === value; });
const atomic = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/u);
const positive = z.string().regex(/^[1-9][0-9]{0,77}$/u);
const solana = z.string().refine((value) => { try { return solanaAddress(value) === value; } catch { return false; } });
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u);
const base64 = z.string().max(2_000_000).refine((value) => Buffer.from(value, "base64").toString("base64") === value);
const stateSchema = z.enum(X402_SOLANA_STATES as [X402SolanaState, ...X402SolanaState[]]);

const termsSchema = z.strictObject({
  url: z.string().max(2048), origin: z.string().max(256), urlHash: hash, challengeHash: hash,
  resourceCanonicalJson: z.string().max(65_536), offerIndex: z.number().int().min(0).max(255), offerCanonicalJson: z.string().max(65_536),
  offerHash: hash, network: z.literal(X402_SOLANA_NETWORK), chain: z.literal(X402_SOLANA_ALLOWLIST_CHAIN),
  payer: solana, mint: solana, symbol: z.string().max(16), decimals: z.number().int().min(0).max(255), sourceTokenAccount: solana,
  payee: solana, destinationTokenAccount: solana, feePayer: solana, amountAtomic: positive, maxAmountAtomic: positive,
  computeUnitLimit: z.number().int().min(1).max(1_400_000), computeUnitPriceMicroLamports: atomic,
  admission: z.strictObject({ policyDigest: hash, policyRevision: z.number().int().positive(), registryVersion: z.string().max(64),
    activationDigest: hash, maximumPerTransferAtomic: positive, dailyLimitAtomic: positive }),
  preparedAt: iso, expiresAt: iso,
});
const lifetimeSchema = z.strictObject({ blockhash: solana, lastValidBlockHeight: atomic, floorSlot: atomic, observedBlockHeight: atomic,
  messageBase64: base64, messageHash: hash, simulationSlot: atomic, unitsConsumed: positive, boundAt: iso });
const leaseSchema = z.strictObject({ reservationId: hash, reservationDigest: hash });
const signedSchema = z.strictObject({ rawPayload: base64, rawPayloadHash: hash, payerSignature: base64 });
const exposureSchema = z.strictObject({ at: iso, paymentHeaderHash: hash });
const resultSchema = z.strictObject({ mediaType: z.string().max(128), bodyEncoding: z.literal("base64").optional(), responseStatus: z.string().max(3).optional(),
  bodyText: z.string().max(2_000_000), resultHash: hash, byteLength: atomic });
const responseSchema = z.strictObject({ status: z.number().int().min(100).max(599), observedAt: iso,
  paymentResponseHeaderHash: hash.optional(), settlementHint: signature.optional(), settlementSuccess: z.boolean().optional(), result: resultSchema.optional() });
const settlementSchema = z.strictObject({ signature, slot: atomic, success: z.boolean(), errorCanonicalJson: z.string().max(1024).nullable(),
  source: z.enum(["payment_response", "signature_index"]), observedAt: iso, rpcOriginHash: hash });
const unlandedSchema = z.strictObject({ finalizedBlockHeight: atomic, lastValidBlockHeight: atomic, floorSlot: atomic, coverageSlot: atomic,
  openedSignatures: z.number().int().min(0), observedAt: iso, rpcOriginHash: hash });
const entrySchema = z.strictObject({ state: stateSchema, at: iso, reason: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), previousHash: hash, entryHash: hash });

const recordSchema = z.strictObject({
  schemaVersion: z.literal(X402_SOLANA_SCHEMA), kind: z.literal(X402_SOLANA_FAMILY), operationId: hash, profile: z.string().max(64),
  profileHash: hash, idempotencyHash: hash, requestHash: hash, terms: termsSchema, fingerprint: hash,
  lifetime: lifetimeSchema.nullable(), lease: leaseSchema.nullable(), signed: signedSchema.nullable(), exposure: exposureSchema.nullable(),
  response: responseSchema.nullable(), settlement: settlementSchema.nullable(), unlanded: unlandedSchema.nullable(),
  state: stateSchema, terminal: z.boolean(), createdAt: iso, updatedAt: iso, journal: z.array(entrySchema).min(1).max(16), integrityHash: hash,
});
export type X402SolanaRecord = z.infer<typeof recordSchema>;
export type X402SolanaTerms = X402SolanaRecord["terms"];
export type X402SolanaBody = Omit<X402SolanaRecord, "integrityHash">;
type Mutable = "lifetime" | "lease" | "signed" | "exposure" | "response" | "settlement" | "unlanded";

export function x402SolanaFingerprint(identity: Pick<X402SolanaRecord, "operationId" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): string {
  return hashObject({ schemaVersion: X402_SOLANA_SCHEMA, operationId: identity.operationId, profileHash: identity.profileHash,
    idempotencyHash: identity.idempotencyHash, requestHash: identity.requestHash, terms: identity.terms });
}

export function newX402SolanaRecord(input: Pick<X402SolanaRecord, "operationId" | "profile" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): X402SolanaRecord {
  const fingerprint = x402SolanaFingerprint(input), at = input.terms.preparedAt;
  const entry = { state: "prepared" as const, at, reason: "prepared_and_frozen", previousHash: fingerprint };
  return seal({ schemaVersion: X402_SOLANA_SCHEMA, kind: X402_SOLANA_FAMILY, ...input, fingerprint, lifetime: null, lease: null, signed: null,
    exposure: null, response: null, settlement: null, unlanded: null, state: "prepared", terminal: false, createdAt: at, updatedAt: at,
    journal: [{ ...entry, entryHash: hashObject(entry) }] });
}

/** A move along the edge table; written fields appear once and are never restated. `response` alone may be added while exposed. */
export function transitionX402Solana(record: X402SolanaRecord, input: { readonly state: X402SolanaState; readonly at: string; readonly reason: string } &
  Partial<Pick<X402SolanaRecord, Mutable>>): X402SolanaRecord {
  validateX402SolanaRecord(record);
  const { state, at, reason, ...fields } = input;
  for (const [key, value] of Object.entries(fields)) {
    const prior = record[key as Mutable];
    if (value === undefined || (prior !== null && canonicalJson(prior) !== canonicalJson(value))) corrupt("A frozen Solana x402 field cannot be restated.");
  }
  const sameState = state === record.state;
  if (sameState ? !(state === "exposed" && Object.keys(fields).length === 1 && "response" in fields) : !EDGES[record.state].includes(state)) {
    corrupt("The Solana x402 transition is not allowed.");
  }
  const { integrityHash: _integrity, ...body } = record;
  const entry = { state, at, reason, previousHash: record.journal.at(-1)!.entryHash };
  return seal({ ...body, ...fields, state, terminal: X402_SOLANA_TERMINAL_STATES.includes(state), updatedAt: at,
    journal: sameState ? body.journal : [...body.journal, { ...entry, entryHash: hashObject(entry) }] });
}

/** Checked against the record's own fields only (R2): its hash chain, fingerprint, state fields and terminal flag. */
export function validateX402SolanaRecord(value: unknown): X402SolanaRecord {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) corrupt("The Solana x402 record violates its schema.");
  const record = parsed.data;
  const { integrityHash, ...body } = record;
  if (hashObject(body) !== integrityHash || x402SolanaFingerprint(record) !== record.fingerprint ||
      record.terminal !== X402_SOLANA_TERMINAL_STATES.includes(record.state) || record.journal.at(-1)!.state !== record.state ||
      record.journal[0]!.state !== "prepared" || record.journal[0]!.previousHash !== record.fingerprint) corrupt("The Solana x402 record does not bind itself.");
  record.journal.forEach((entry, index) => {
    const { entryHash, ...rest } = entry;
    if (hashObject(rest) !== entryHash || (index > 0 && (entry.previousHash !== record.journal[index - 1]!.entryHash ||
        !EDGES[record.journal[index - 1]!.state].includes(entry.state)))) corrupt("The Solana x402 journal chain is broken.");
  });
  const passed = (state: X402SolanaState) => record.journal.some((entry) => entry.state === state);
  // Each field exists exactly from the transition that writes it.
  if ((record.lifetime !== null) !== passed("reserving") || (record.signed !== null) !== passed("signed") || (record.lease !== null) !== passed("signed") ||
      (record.exposure !== null) !== passed("exposed") || (record.response !== null && !passed("exposed")) ||
      (record.settlement !== null) !== (record.state === "settled" || record.state === "failed_onchain") ||
      (record.unlanded !== null) !== (record.state === "expired_unlanded") ||
      (record.settlement !== null && record.settlement.success !== (record.state === "settled"))) corrupt("The Solana x402 record fields disagree with its state.");
  return record;
}

export function x402SolanaRecordBody(record: X402SolanaRecord): X402SolanaBody {
  const { integrityHash: _integrity, ...body } = record;
  return body;
}
function seal(body: X402SolanaBody): X402SolanaRecord {
  return validateX402SolanaRecord({ ...body, integrityHash: hashObject(body) });
}
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
