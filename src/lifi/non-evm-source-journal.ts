/** Isolated source-effect journal. Admission proof is synthetic and never grants execution authority.
 * No route, custody, transport, or CLI imports this module.
 */
import { hashObject, sha256 } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { z } from "zod";
import { addressSchema, hashSchema, hexSchema, isoSchema, uintSchema, wordSchema } from "./schema.js";
import { bridgeFailure, BRIDGE_DIAMOND } from "./validation.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "./circle-v2-source-receipt.js";

const pair = z.enum(["base_usdc_to_solana_usdc_circle_cctp_v2", "base_usdc_to_tron_usdt_lifi_near_intents"]);
const call = z.strictObject({ chainId: z.literal(8453), from: addressSchema, to: addressSchema,
  valueAtomic: uintSchema, data: hexSchema, dataSha256: hashSchema });
const proof = z.strictObject({ kind: z.literal("synthetic_untrusted"), claimedValidationHash: hashSchema,
  note: z.string().min(1).max(256) });
const safe = z.strictObject({ provenance: z.literal("synthetic_untrusted"), transactionHash: wordSchema, status: z.enum(["success", "reverted"]),
  blockNumberAtomic: uintSchema, blockHash: wordSchema, safeBlockNumberAtomic: uintSchema,
  safeBlockHash: wordSchema, observedAt: isoSchema });
const phase = z.enum(["staged_untrusted", "signing_started", "sealed", "submitting", "submitted_pending",
  "unknown_finality", "source_confirmed", "source_reverted"]);
const snapshot = z.strictObject({ phase, signedTransaction: hexSchema.nullable(), transactionHash: wordSchema.nullable(),
  nonceAtomic: uintSchema.nullable(), submissionAttempts: z.union([z.literal(0), z.literal(1)]),
  safeSourceProof: safe.nullable(), reason: z.string().max(128).nullable() });
const entry = z.strictObject({ ...snapshot.shape, at: isoSchema, previousHash: hashSchema, transitionHash: hashSchema });
const schema = z.strictObject({ schemaVersion: z.literal("apn.non-evm-source-journal.v1"),
  kind: z.literal("non_evm_source_journal"), executionAdmitted: z.literal(false),
  profileHash: hashSchema, operationId: hashSchema, draftIntegrityHash: hashSchema,
  route: pair, sourceCall: call, admissionProof: proof, createdAt: isoSchema,
  ...snapshot.shape, transitions: z.array(entry).min(1).max(32), integrityHash: hashSchema });
export type NonEvmSourceJournal = z.infer<typeof schema>;
export type NonEvmSourceBinding = Pick<NonEvmSourceJournal, "profileHash" | "operationId" | "draftIntegrityHash" | "route" | "sourceCall" | "admissionProof" | "createdAt">;
export type SafeSourceObservation = z.infer<typeof safe>;
type Phase = z.infer<typeof phase>;
type Snapshot = z.infer<typeof snapshot>;
function corrupt(): never { return bridgeFailure("APN_STATE_CORRUPT", "non_evm_source_journal"); }
function blocked(): never { return bridgeFailure("APN_OPERATION_BLOCKED", "non_evm_source_transition_blocked"); }
function snapshotOf(j: NonEvmSourceJournal): Snapshot {
  return { phase: j.phase, signedTransaction: j.signedTransaction, transactionHash: j.transactionHash,
    nonceAtomic: j.nonceAtomic, submissionAttempts: j.submissionAttempts,
    safeSourceProof: j.safeSourceProof, reason: j.reason };
}
const edges: Record<Phase, readonly Phase[]> = {
  staged_untrusted: ["signing_started"], signing_started: ["sealed"], sealed: ["submitting"],
  submitting: ["submitted_pending", "unknown_finality", "source_confirmed", "source_reverted"],
  submitted_pending: ["unknown_finality", "source_confirmed", "source_reverted"],
  unknown_finality: ["source_confirmed", "source_reverted"],
  source_confirmed: ["unknown_finality"], source_reverted: ["unknown_finality"],
};
function checkSigned(j: NonEvmSourceJournal, raw: `0x${string}`, nonce: string): string {
  let tx: ReturnType<typeof parseTransaction>;
  try { tx = parseTransaction(raw); } catch { corrupt(); }
  if (tx.chainId !== 8453 || tx.to?.toLowerCase() !== j.sourceCall.to.toLowerCase() || tx.data !== j.sourceCall.data ||
    (tx.value ?? 0n) !== BigInt(j.sourceCall.valueAtomic) || tx.nonce !== Number(nonce) ||
    !Number.isSafeInteger(Number(nonce)) || tx.r === undefined || tx.s === undefined || (tx.v === undefined && tx.yParity === undefined)) corrupt();
  return keccak256(raw);
}
export function validateNonEvmSourceJournal(value: unknown): NonEvmSourceJournal {
  const p = schema.safeParse(value); if (!p.success) corrupt();
  const j = p.data, { integrityHash, ...body } = j;
  if (hashObject(body) !== integrityHash || j.sourceCall.dataSha256 !== sha256(Buffer.from(j.sourceCall.data.slice(2), "hex")) ||
    (j.route === "base_usdc_to_solana_usdc_circle_cctp_v2"
      ? j.sourceCall.to !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || !j.sourceCall.data.startsWith("0xc62fa55e")
      : j.sourceCall.to !== BRIDGE_DIAMOND || !j.sourceCall.data.startsWith("0x3110c7b9"))) corrupt();
  let prior: z.infer<typeof entry> | undefined;
  for (const e of j.transitions) {
    const { transitionHash, ...content } = e;
    if (hashObject(content) !== transitionHash || e.previousHash !== (prior?.transitionHash ?? j.draftIntegrityHash)) corrupt();
    if (prior === undefined) {
      if (e.phase !== "staged_untrusted" || e.at !== j.createdAt) corrupt();
    } else if (!edges[prior.phase].includes(e.phase) || e.at < prior.at) corrupt();
    if (e.submissionAttempts !== (e.phase === "staged_untrusted" || e.phase === "signing_started" || e.phase === "sealed" ? 0 : 1)) corrupt();
    if (e.phase === "staged_untrusted" || e.phase === "signing_started") {
      if (e.signedTransaction !== null || e.transactionHash !== null || e.nonceAtomic !== null) corrupt();
    } else {
      if (e.signedTransaction === null || e.transactionHash === null || e.nonceAtomic === null ||
        checkSigned(j, e.signedTransaction as `0x${string}`, e.nonceAtomic) !== e.transactionHash) corrupt();
    }
    if (prior !== undefined && prior.phase !== "staged_untrusted" && prior.phase !== "signing_started" &&
      (prior.signedTransaction !== e.signedTransaction || prior.transactionHash !== e.transactionHash || prior.nonceAtomic !== e.nonceAtomic)) corrupt();
    if ((e.phase === "source_confirmed" || e.phase === "source_reverted") !== (e.safeSourceProof !== null)) corrupt();
    if (e.safeSourceProof !== null && (e.safeSourceProof.transactionHash !== e.transactionHash ||
      e.safeSourceProof.status !== (e.phase === "source_confirmed" ? "success" : "reverted") ||
      BigInt(e.safeSourceProof.safeBlockNumberAtomic) < BigInt(e.safeSourceProof.blockNumberAtomic))) corrupt();
    prior = e;
  }
  if (prior === undefined || hashObject(snapshotOf(j)) !== hashObject(snapshotOf(prior as unknown as NonEvmSourceJournal))) corrupt();
  return j;
}
function build(binding: NonEvmSourceBinding): NonEvmSourceJournal {
  const initial: Snapshot = { phase: "staged_untrusted", signedTransaction: null, transactionHash: null,
    nonceAtomic: null, submissionAttempts: 0, safeSourceProof: null, reason: null };
  const first = { ...initial, at: binding.createdAt, previousHash: binding.draftIntegrityHash };
  const value = { schemaVersion: "apn.non-evm-source-journal.v1" as const, kind: "non_evm_source_journal" as const,
    executionAdmitted: false as const, ...binding, ...initial,
    transitions: [{ ...first, transitionHash: hashObject(first) }] };
  return validateNonEvmSourceJournal({ ...value, integrityHash: hashObject(value) });
}
function advance(j: NonEvmSourceJournal, next: Snapshot, at: string): NonEvmSourceJournal {
  if (!edges[j.phase].includes(next.phase)) blocked();
  const stamp = isoSchema.safeParse(at); if (!stamp.success || at < j.transitions.at(-1)!.at) blocked();
  const step = { ...next, at, previousHash: j.transitions.at(-1)!.transitionHash };
  const { integrityHash: _old, ...base } = j;
  const updated = { ...base, ...next, transitions: [...j.transitions, { ...step, transitionHash: hashObject(step) }] };
  return validateNonEvmSourceJournal({ ...updated, integrityHash: hashObject(updated) });
}
/** All mutations lock the exact draft identity and compare the expected record hash. */
export class NonEvmSourceJournalRepository extends SecureStateStore {
  private path(profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "profile hash"); stateIdentifier(operationId, "operation ID");
    return `non-evm-source-journals/${profileHash}/${operationId}.json`;
  }
  async load(profileHash: string, operationId: string): Promise<NonEvmSourceJournal | null> {
    const raw = await this.readJson(this.path(profileHash, operationId));
    if (raw === null) return null;
    const j = validateNonEvmSourceJournal(raw);
    if (j.profileHash !== profileHash || j.operationId !== operationId) corrupt();
    return j;
  }
  /** A synthetically supplied proof is permanently untrusted. An adapter must introduce a new versioned admission contract. */
  async stage(binding: NonEvmSourceBinding): Promise<NonEvmSourceJournal> {
    const j = build(binding); await this.initialize();
    return this.withLocks([`profile:${j.profileHash}`, `operation:${j.operationId}`], async () => {
      const prior = await this.load(j.profileHash, j.operationId);
      if (prior !== null) { if (prior.draftIntegrityHash !== j.draftIntegrityHash || prior.route !== j.route ||
        hashObject(prior.sourceCall) !== hashObject(j.sourceCall) ||
        hashObject(prior.admissionProof) !== hashObject(j.admissionProof) || prior.createdAt !== j.createdAt) corrupt(); return prior; }
      await this.ensureDirectory(`non-evm-source-journals/${j.profileHash}`);
      await this.writeJson(this.path(j.profileHash, j.operationId), j); return j;
    });
  }
  private async change(profileHash: string, operationId: string, expectedHash: string,
    update: (j: NonEvmSourceJournal) => NonEvmSourceJournal | Promise<NonEvmSourceJournal>): Promise<NonEvmSourceJournal> {
    await this.initialize();
    return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
      const prior = await this.load(profileHash, operationId); if (prior === null || prior.integrityHash !== expectedHash) blocked();
      const next = await update(prior); await this.writeJson(this.path(profileHash, operationId), next); return next;
    });
  }
  async signingStarted(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal> {
    return this.change(profileHash, operationId, expectedHash, j => advance(j, { ...snapshotOf(j), phase: "signing_started" }, at));
  }
  async seal(profileHash: string, operationId: string, expectedHash: string, raw: `0x${string}`, nonceAtomic: string, at: string): Promise<NonEvmSourceJournal> {
    return this.change(profileHash, operationId, expectedHash, async j => {
      if (j.phase !== "signing_started" || !uintSchema.safeParse(nonceAtomic).success) blocked();
      const hash = checkSigned(j, raw, nonceAtomic);
      let signer: string;
      try { signer = await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] }); } catch { corrupt(); }
      if (signer.toLowerCase() !== j.sourceCall.from.toLowerCase()) corrupt();
      return advance(j, { ...snapshotOf(j), phase: "sealed", signedTransaction: raw, transactionHash: hash, nonceAtomic }, at);
    });
  }
  /** Commit the sole attempt before a future adapter may send. No send or retry method exists here. */
  async committingSubmission(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal> {
    return this.change(profileHash, operationId, expectedHash, j => advance(j,
      { ...snapshotOf(j), phase: "submitting", submissionAttempts: 1 }, at));
  }
  async observePending(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal> {
    return this.change(profileHash, operationId, expectedHash, j => advance(j,
      { ...snapshotOf(j), phase: "submitted_pending" }, at));
  }
  async observeUnknown(profileHash: string, operationId: string, expectedHash: string, reason: string, at: string): Promise<NonEvmSourceJournal> {
    return this.change(profileHash, operationId, expectedHash, j => advance(j,
      { ...snapshotOf(j), phase: "unknown_finality", safeSourceProof: null, reason }, at));
  }
  /** Stores a claimed safe observation for offline state testing; provenance remains untrusted. */
  async observeSafeSource(profileHash: string, operationId: string, expectedHash: string,
    observation: SafeSourceObservation, at: string): Promise<NonEvmSourceJournal> {
    if (!safe.safeParse(observation).success) blocked();
    return this.change(profileHash, operationId, expectedHash, j => advance(j,
      { ...snapshotOf(j), phase: observation.status === "success" ? "source_confirmed" : "source_reverted",
        safeSourceProof: observation, reason: null }, at));
  }
}
