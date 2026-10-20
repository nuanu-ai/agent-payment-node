import { getAddress } from "viem";
import { z } from "zod";
import { canonicalJson, hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { PERMIT2_ADDRESS } from "../registry.js";

export const PERMIT2_ALLOWANCE_SCHEMA = "apn.x402-permit2-allowance.v1" as const;
export const PERMIT2_ALLOWANCE_FAMILY = "permit2_allowance" as const;
export const PERMIT2_ALLOWANCE_STORE = "permit2-allowance" as const;

export type Permit2AllowanceState = "prepared" | "signed" | "submitted" | "completed" | "reverted" | "superseded" | "failed_before_effect" |
  "abandoned_unknown";
/**
 * One owner-approved ERC-20 `approve(Permit2, amount)` (or its revoke to zero) from the local wallet. `prepared`: frozen
 * and unsigned. `signed`: the exact transaction is sealed and was never sent. `submitted`: the single send was started.
 * Outcomes: a receipt at the chain's proof tag (completed or reverted), the chain's proof that it can never land
 * (superseded: the nonce went to another finalized transaction), never signed (failed_before_effect) or the owner's abandon.
 */
const EDGES: Readonly<Record<Permit2AllowanceState, readonly Permit2AllowanceState[]>> = {
  prepared: ["signed", "failed_before_effect"],
  signed: ["submitted", "superseded", "abandoned_unknown"],
  submitted: ["completed", "reverted", "superseded", "abandoned_unknown"],
  completed: [], reverted: [], superseded: [], failed_before_effect: [], abandoned_unknown: [],
};
export const PERMIT2_ALLOWANCE_STATES = Object.keys(EDGES) as readonly Permit2AllowanceState[];
export const PERMIT2_ALLOWANCE_TERMINAL_STATES: readonly Permit2AllowanceState[] = PERMIT2_ALLOWANCE_STATES.filter((state) => EDGES[state].length === 0);

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const word = z.string().regex(/^0x[a-f0-9]{64}$/u);
const iso = z.string().refine((value) => { const at = Date.parse(value); return Number.isFinite(at) && new Date(at).toISOString() === value; });
const atomic = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/u);
const evm = z.string().refine((value) => { try { return getAddress(value) === value; } catch { return false; } });
const stateSchema = z.enum(PERMIT2_ALLOWANCE_STATES as [Permit2AllowanceState, ...Permit2AllowanceState[]]);

const termsSchema = z.strictObject({
  action: z.enum(["set", "revoke"]), chainId: z.number().int().positive().safe(), proofTag: z.enum(["safe", "finalized"]),
  token: evm, owner: evm, spender: z.literal(PERMIT2_ADDRESS), amountAtomic: atomic, priorAllowanceAtomic: atomic,
  admission: z.strictObject({ source: z.enum(["profile_x402_policy", "allowlist_permit2_row", "revoke"]), boundAtomic: atomic.nullable(), digest: hash.nullable() }),
  nonce: atomic, gasLimit: atomic, maxFeePerGasWei: atomic, maxPriorityFeePerGasWei: atomic, maxNativeDebitWei: atomic,
  era: z.strictObject({ number: atomic, hash: word }), rpcOrigin: z.string().max(256), preparedAt: iso, expiresAt: iso,
});
const outcomeSchema = z.union([
  z.strictObject({ kind: z.literal("receipt"), blockNumber: atomic, blockHash: word, status: z.enum(["success", "reverted"]),
    approvalLog: z.boolean(), allowanceAtTagAtomic: atomic.nullable(), tag: z.enum(["safe", "finalized"]), observedAt: iso }),
  z.strictObject({ kind: z.literal("never_lands"), finalizedNonce: atomic, observedAt: iso }),
]);
const entrySchema = z.strictObject({ state: stateSchema, at: iso, reason: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), previousHash: hash, entryHash: hash });
const recordSchema = z.strictObject({
  schemaVersion: z.literal(PERMIT2_ALLOWANCE_SCHEMA), kind: z.literal(PERMIT2_ALLOWANCE_FAMILY), operationId: hash, profile: z.string().max(64),
  profileHash: hash, idempotencyHash: hash, requestHash: hash, terms: termsSchema, fingerprint: hash,
  signed: z.strictObject({ rawTransaction: z.string().regex(/^0x02[a-f0-9]+$/u).max(4096), transactionHash: word }).nullable(),
  submittedAt: iso.nullable(), outcome: outcomeSchema.nullable(),
  state: stateSchema, terminal: z.boolean(), createdAt: iso, updatedAt: iso, journal: z.array(entrySchema).min(1).max(8), integrityHash: hash,
});
export type Permit2AllowanceRecord = z.infer<typeof recordSchema>;
export type Permit2AllowanceTerms = Permit2AllowanceRecord["terms"];
type Mutable = "signed" | "submittedAt" | "outcome";

export function newPermit2Allowance(input: Pick<Permit2AllowanceRecord, "operationId" | "profile" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): Permit2AllowanceRecord {
  const fingerprint = hashObject({ schemaVersion: PERMIT2_ALLOWANCE_SCHEMA, operationId: input.operationId, profileHash: input.profileHash,
    idempotencyHash: input.idempotencyHash, requestHash: input.requestHash, terms: input.terms });
  const entry = { state: "prepared" as const, at: input.terms.preparedAt, reason: "prepared_and_frozen", previousHash: fingerprint };
  return seal({ schemaVersion: PERMIT2_ALLOWANCE_SCHEMA, kind: PERMIT2_ALLOWANCE_FAMILY, ...input, fingerprint, signed: null, submittedAt: null,
    outcome: null, state: "prepared", terminal: false, createdAt: entry.at, updatedAt: entry.at, journal: [{ ...entry, entryHash: hashObject(entry) }] });
}

export function transitionPermit2Allowance(record: Permit2AllowanceRecord, input: { readonly state: Permit2AllowanceState; readonly at: string;
  readonly reason: string } & Partial<Pick<Permit2AllowanceRecord, Mutable>>): Permit2AllowanceRecord {
  validatePermit2Allowance(record);
  const { state, at, reason, ...fields } = input;
  if (!EDGES[record.state].includes(state)) corrupt("The Permit2 allowance transition is not allowed.");
  for (const [key, value] of Object.entries(fields)) {
    const prior = record[key as Mutable];
    if (value === undefined || (prior !== null && canonicalJson(prior) !== canonicalJson(value))) corrupt("A written Permit2 allowance field cannot change.");
  }
  const { integrityHash: _integrity, ...body } = record;
  const entry = { state, at, reason, previousHash: record.journal.at(-1)!.entryHash };
  return seal({ ...body, ...fields, state, terminal: PERMIT2_ALLOWANCE_TERMINAL_STATES.includes(state), updatedAt: at,
    journal: [...body.journal, { ...entry, entryHash: hashObject(entry) }] });
}

/** Checked against the record's own fields (R2): hash chain, fingerprint, terminal flag and which fields each state has. */
export function validatePermit2Allowance(value: unknown): Permit2AllowanceRecord {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) corrupt("The Permit2 allowance record violates its schema.");
  const record = parsed.data, { integrityHash, ...body } = record;
  const fingerprint = hashObject({ schemaVersion: PERMIT2_ALLOWANCE_SCHEMA, operationId: record.operationId, profileHash: record.profileHash,
    idempotencyHash: record.idempotencyHash, requestHash: record.requestHash, terms: record.terms });
  if (hashObject(body) !== integrityHash || fingerprint !== record.fingerprint || record.terminal !== PERMIT2_ALLOWANCE_TERMINAL_STATES.includes(record.state) ||
      record.journal[0]!.state !== "prepared" || record.journal[0]!.previousHash !== fingerprint || record.journal.at(-1)!.state !== record.state ||
      (record.terms.action === "revoke") !== (record.terms.amountAtomic === "0")) corrupt("The Permit2 allowance record does not bind itself.");
  record.journal.forEach((entry, index) => {
    const { entryHash, ...rest } = entry;
    if (hashObject(rest) !== entryHash || (index > 0 && (entry.previousHash !== record.journal[index - 1]!.entryHash ||
        !EDGES[record.journal[index - 1]!.state].includes(entry.state)))) corrupt("The Permit2 allowance journal chain is broken.");
  });
  const passed = (state: Permit2AllowanceState) => record.journal.some((entry) => entry.state === state);
  if ((record.signed !== null) !== passed("signed") || (record.submittedAt !== null) !== passed("submitted") ||
      (record.outcome !== null) !== ["completed", "reverted", "superseded"].includes(record.state) ||
      (record.outcome?.kind === "never_lands") !== (record.state === "superseded")) corrupt("The Permit2 allowance fields disagree with its state.");
  return record;
}

function seal(body: Omit<Permit2AllowanceRecord, "integrityHash">): Permit2AllowanceRecord {
  return validatePermit2Allowance({ ...body, integrityHash: hashObject(body) });
}
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
