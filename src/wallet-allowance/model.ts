import { getAddress } from "viem";
import { z } from "zod";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";

export const WALLET_ALLOWANCE_REVOKE_SCHEMA = "apn.wallet-allowance-revoke.v1" as const;
export const WALLET_ALLOWANCE_REVOKE_FAMILY = "wallet_allowance_revoke" as const;
export const WALLET_ALLOWANCE_REVOKE_STORE = "wallet-allowance-revokes" as const;

export type WalletAllowanceRevokeState = "prepared" | "signed" | "submitted" | "completed" | "reverted" | "superseded" | "failed_before_effect" |
  "abandoned_unknown";
/**
 * One owner-approved ERC-20 `approve(spender, 0)` from the profile's local wallet: it only removes a permission, so it
 * needs no asset admission. `prepared`: frozen and unsigned. `signed`: the exact transaction is sealed and was never sent.
 * `submitted`: the single send was started. Outcomes: a receipt at the chain's proof tag (completed or reverted), the
 * chain's proof that it can never land (superseded), never signed (failed_before_effect) or the owner's abandon.
 */
const EDGES: Readonly<Record<WalletAllowanceRevokeState, readonly WalletAllowanceRevokeState[]>> = {
  prepared: ["signed", "failed_before_effect"],
  signed: ["submitted", "superseded", "abandoned_unknown"],
  submitted: ["completed", "reverted", "superseded", "abandoned_unknown"],
  completed: [], reverted: [], superseded: [], failed_before_effect: [], abandoned_unknown: [],
};
export const WALLET_ALLOWANCE_REVOKE_STATES = Object.keys(EDGES) as readonly WalletAllowanceRevokeState[];
export const WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES: readonly WalletAllowanceRevokeState[] = WALLET_ALLOWANCE_REVOKE_STATES.filter((state) => EDGES[state].length === 0);

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const word = z.string().regex(/^0x[a-f0-9]{64}$/u);
const iso = z.string().refine((value) => { const at = Date.parse(value); return Number.isFinite(at) && new Date(at).toISOString() === value; });
const atomic = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/u);
const evm = z.string().refine((value) => { try { return getAddress(value) === value; } catch { return false; } });
const stateSchema = z.enum(WALLET_ALLOWANCE_REVOKE_STATES as [WalletAllowanceRevokeState, ...WalletAllowanceRevokeState[]]);

const termsSchema = z.strictObject({
  chainId: z.number().int().positive().safe(), proofTag: z.enum(["safe", "finalized"]), rpcSetting: z.string().regex(/^APN_[A-Z0-9_]+_RPC_URL$/u),
  token: evm, owner: evm, spender: evm, priorAllowanceAtomic: atomic, nonce: atomic, gasLimit: atomic, maxFeePerGasWei: atomic,
  maxPriorityFeePerGasWei: atomic, maxNativeDebitWei: atomic, era: z.strictObject({ number: atomic, hash: word }), preparedAt: iso, expiresAt: iso,
});
const outcomeSchema = z.union([
  z.strictObject({ kind: z.literal("receipt"), blockNumber: atomic, blockHash: word, status: z.enum(["success", "reverted"]),
    approvalLog: z.boolean(), allowanceAtTagAtomic: atomic, tag: z.enum(["safe", "finalized"]), observedAt: iso }),
  z.strictObject({ kind: z.literal("never_lands"), finalizedNonce: atomic, observedAt: iso }),
]);
const entrySchema = z.strictObject({ state: stateSchema, at: iso, reason: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), previousHash: hash, entryHash: hash });
const recordSchema = z.strictObject({
  schemaVersion: z.literal(WALLET_ALLOWANCE_REVOKE_SCHEMA), kind: z.literal(WALLET_ALLOWANCE_REVOKE_FAMILY), operationId: hash, profile: z.string().max(64),
  profileHash: hash, idempotencyHash: hash, requestHash: hash, terms: termsSchema, fingerprint: hash,
  signed: z.strictObject({ rawTransaction: z.string().regex(/^0x02[a-f0-9]+$/u).max(4096), transactionHash: word }).nullable(),
  submittedAt: iso.nullable(), outcome: outcomeSchema.nullable(),
  state: stateSchema, terminal: z.boolean(), createdAt: iso, updatedAt: iso, journal: z.array(entrySchema).min(1).max(8), integrityHash: hash,
});
export type WalletAllowanceRevokeRecord = z.infer<typeof recordSchema>;
export type WalletAllowanceRevokeTerms = WalletAllowanceRevokeRecord["terms"];
type Mutable = "signed" | "submittedAt" | "outcome";

export function newWalletAllowanceRevoke(input: Pick<WalletAllowanceRevokeRecord, "operationId" | "profile" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): WalletAllowanceRevokeRecord {
  const fingerprint = fingerprintOf(input);
  const entry = { state: "prepared" as const, at: input.terms.preparedAt, reason: "prepared_and_frozen", previousHash: fingerprint };
  return seal({ schemaVersion: WALLET_ALLOWANCE_REVOKE_SCHEMA, kind: WALLET_ALLOWANCE_REVOKE_FAMILY, ...input, fingerprint, signed: null, submittedAt: null,
    outcome: null, state: "prepared", terminal: false, createdAt: entry.at, updatedAt: entry.at, journal: [{ ...entry, entryHash: hashObject(entry) }] });
}

export function transitionWalletAllowanceRevoke(record: WalletAllowanceRevokeRecord, input: { readonly state: WalletAllowanceRevokeState; readonly at: string;
  readonly reason: string } & Partial<Pick<WalletAllowanceRevokeRecord, Mutable>>): WalletAllowanceRevokeRecord {
  validateWalletAllowanceRevoke(record);
  const { state, at, reason, ...fields } = input;
  if (!EDGES[record.state].includes(state)) corrupt("The allowance revoke transition is not allowed.");
  for (const [key, value] of Object.entries(fields)) {
    const prior = record[key as Mutable];
    if (value === undefined || (prior !== null && canonicalJson(prior) !== canonicalJson(value))) corrupt("A written allowance revoke field cannot change.");
  }
  const { integrityHash: _integrity, ...body } = record;
  const entry = { state, at, reason, previousHash: record.journal.at(-1)!.entryHash };
  return seal({ ...body, ...fields, state, terminal: WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES.includes(state), updatedAt: at,
    journal: [...body.journal, { ...entry, entryHash: hashObject(entry) }] });
}

/** Checked against the record's own fields (R2): hash chain, fingerprint, terminal flag and which fields each state has. */
export function validateWalletAllowanceRevoke(value: unknown): WalletAllowanceRevokeRecord {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) corrupt("The allowance revoke record violates its schema.");
  const record = parsed.data, { integrityHash, ...body } = record;
  if (hashObject(body) !== integrityHash || fingerprintOf(record) !== record.fingerprint || record.terminal !== WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES.includes(record.state) ||
      record.journal[0]!.state !== "prepared" || record.journal[0]!.previousHash !== record.fingerprint || record.journal.at(-1)!.state !== record.state ||
      record.terms.priorAllowanceAtomic === "0" || record.terms.token === record.terms.spender) corrupt("The allowance revoke record does not bind itself.");
  record.journal.forEach((entry, index) => {
    const { entryHash, ...rest } = entry;
    if (hashObject(rest) !== entryHash || (index > 0 && (entry.previousHash !== record.journal[index - 1]!.entryHash ||
        !EDGES[record.journal[index - 1]!.state].includes(entry.state)))) corrupt("The allowance revoke journal chain is broken.");
  });
  const passed = (state: WalletAllowanceRevokeState) => record.journal.some((entry) => entry.state === state);
  if ((record.signed !== null) !== passed("signed") || (record.submittedAt !== null) !== passed("submitted") ||
      (record.outcome !== null) !== ["completed", "reverted", "superseded"].includes(record.state) ||
      (record.outcome?.kind === "never_lands") !== (record.state === "superseded")) corrupt("The allowance revoke fields disagree with its state.");
  return record;
}

/** The slot one open revoke holds: the same profile, chain, token and spender continue it, never a second one. */
export function walletAllowanceSlot(record: { readonly profileHash: string; readonly terms: Pick<WalletAllowanceRevokeTerms, "chainId" | "token" | "spender"> }): string {
  return hashObject({ profileHash: record.profileHash, chainId: record.terms.chainId, token: record.terms.token, spender: record.terms.spender });
}
function fingerprintOf(input: Pick<WalletAllowanceRevokeRecord, "operationId" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): string {
  return hashObject({ schemaVersion: WALLET_ALLOWANCE_REVOKE_SCHEMA, operationId: input.operationId, profileHash: input.profileHash,
    idempotencyHash: input.idempotencyHash, requestHash: input.requestHash, terms: input.terms });
}
function seal(body: Omit<WalletAllowanceRevokeRecord, "integrityHash">): WalletAllowanceRevokeRecord {
  return validateWalletAllowanceRevoke({ ...body, integrityHash: hashObject(body) });
}
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
