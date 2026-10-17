import { getAddress } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import type { LegacyStargateEnvelope } from "./native-record.js";
import { fail, LEGACY_NATIVE_LANE, LEGACY_TOKEN_LANE, UINT } from "./pins.js";
import { LEGACY_STARGATE_DIRECTORY, legacyStargateFamily, type LegacyStargateFamily, type LegacyStargateRecord } from "./reader.js";

export const LEGACY_CLOSURE_SCHEMA = "apn.stargate-v2-legacy-closure.v1";
/** The only closure: at the finalized block the signer's nonce is past every envelope of the record and none of its own transactions is pending. */
export const LEGACY_CLOSURE_REASON = "legacy_closed_nonce_consumed";
export type LegacyOwnTransactionSeen = "not_found" | "included";
export interface LegacyStargateClosure {
  readonly schemaVersion: typeof LEGACY_CLOSURE_SCHEMA; readonly family: LegacyStargateFamily; readonly operationId: string;
  readonly recordSchemaVersion: string; readonly recordIntegrityHash: string; readonly recordPhase: string;
  readonly reason: typeof LEGACY_CLOSURE_REASON; readonly chainId: number; readonly account: string; readonly blockTag: "finalized";
  readonly highestEnvelopeNonceAtomic: string; readonly finalizedNonceAtomic: string;
  readonly ownTransactions: readonly { readonly transactionHash: string; readonly seen: LegacyOwnTransactionSeen }[];
  readonly closedAt: string; readonly integrityHash: string;
}
const CLOSURE_KEYS = ["account", "blockTag", "chainId", "closedAt", "family", "finalizedNonceAtomic", "highestEnvelopeNonceAtomic",
  "integrityHash", "operationId", "ownTransactions", "reason", "recordIntegrityHash", "recordPhase", "recordSchemaVersion", "schemaVersion"];
const HASH = /^0x[0-9a-fA-F]{64}$/u;

/** What the record itself says the closure check must prove: its signing chain and account, every nonce it froze, and its own hashes. */
export interface LegacyClosureFacts {
  readonly family: LegacyStargateFamily; readonly chainId: number; readonly account: string;
  readonly highestNonce: bigint; readonly ownHashes: readonly string[];
}
export function legacyClosureFacts(record: LegacyStargateRecord): LegacyClosureFacts {
  const family = legacyStargateFamily(record);
  const chainId = family === "stargate_native" ? LEGACY_NATIVE_LANE.sourceChain : LEGACY_TOKEN_LANE.sourceChain;
  const envelopes: readonly (LegacyStargateEnvelope | undefined)[] = record.schemaVersion === "apn.stargate-v2-native-operation.v1" ? [record.envelope]
    : [record.approvalEnvelope, record.sendEnvelope, record.cleanupEnvelope];
  const ownHashes = (record.schemaVersion === "apn.stargate-v2-native-operation.v1" ? [record.transactionHash]
    : [record.approvalTransactionHash, record.transactionHash, record.cleanupTransactionHash]).filter((hash): hash is string => hash !== undefined);
  let account: string;
  try { account = getAddress(record.owner); } catch { return fail("legacy_owner"); }
  let highest = -1n;
  for (const envelope of envelopes) {
    if (envelope === undefined) continue;
    if (envelope.chainId !== chainId || typeof envelope.from !== "string" || envelope.from.toLowerCase() !== account.toLowerCase() ||
      typeof envelope.nonceAtomic !== "string" || !UINT.test(envelope.nonceAtomic)) fail("legacy_envelope_binding");
    const nonce = BigInt(envelope.nonceAtomic);
    if (nonce > highest) highest = nonce;
  }
  if (highest < 0n || ownHashes.some(hash => !HASH.test(hash))) fail("legacy_envelope_binding");
  return { family, chainId, account, highestNonce: highest, ownHashes };
}

/** The phases the 60b247d5^ runtimes never left: an observed or reverted native send, an observed or cleaned token operation. */
export function legacyPhaseTerminal(record: LegacyStargateRecord): boolean {
  return record.schemaVersion === "apn.stargate-v2-native-operation.v1"
    ? record.phase === "observed" || record.phase === "failed_confirmed_revert" : record.phase === "observed" || record.phase === "cleaned";
}

/** Terminal by its own phase, or by a valid closure sidecar bound to this exact record. A damaged sidecar throws (undecidable). */
export async function legacyStargateTerminal(root: string, record: LegacyStargateRecord): Promise<boolean> {
  return legacyPhaseTerminal(record) || await new LegacyStargateClosureStore(root).load(record) !== null;
}

export function sealLegacyClosure(fields: Omit<LegacyStargateClosure, "integrityHash">): LegacyStargateClosure {
  return Object.freeze({ ...fields, integrityHash: hashObject(fields) });
}

/**
 * `<family directory>/<operationId>.legacy-closure.json` beside the record (never a record name, so the operation index
 * walk skips it). Create-only: the record is never rewritten, and the operation index, a rebuildable cache, re-derives
 * the record as terminal from this file after `rm -r operation-index`.
 */
export class LegacyStargateClosureStore extends SecureStateStore {
  private path(record: LegacyStargateRecord): string {
    stateIdentifier(record.operationId, "Stargate legacy closure operation");
    return `${LEGACY_STARGATE_DIRECTORY[legacyStargateFamily(record)]}/${record.operationId}.legacy-closure.json`;
  }
  async load(record: LegacyStargateRecord): Promise<LegacyStargateClosure | null> {
    const value = await this.readJson(this.path(record));
    return value === null ? null : validateClosure(value, record);
  }
  /** Publishes the closure once; a concurrent closer's file wins and is returned after the same validation. */
  async create(record: LegacyStargateRecord, closure: LegacyStargateClosure): Promise<LegacyStargateClosure> {
    validateClosure(closure, record);
    try { await this.writeJson(this.path(record), closure, true); }
    catch (error) {
      if (!(error instanceof ApnError) || error.message !== "State target is already occupied.") throw error;
      const existing = await this.load(record);
      if (existing === null) throw error;
      return existing;
    }
    return closure;
  }
}

function closureCorrupt(reason: string): never {
  throw new ApnError("APN_STATE_CORRUPT", "The closure of an unreleased Stargate record is not the one this record allows.", { reason });
}
function validateClosure(value: unknown, record: LegacyStargateRecord): LegacyStargateClosure {
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(CLOSURE_KEYS)) closureCorrupt("closure_shape");
  const closure = value as unknown as LegacyStargateClosure, { integrityHash, ...fields } = closure, facts = legacyClosureFacts(record);
  const own = Array.isArray(closure.ownTransactions) ? closure.ownTransactions : [];
  if (closure.schemaVersion !== LEGACY_CLOSURE_SCHEMA || hashObject(fields) !== integrityHash || closure.family !== facts.family ||
    closure.operationId !== record.operationId || closure.recordSchemaVersion !== record.schemaVersion ||
    closure.recordIntegrityHash !== record.integrityHash || closure.recordPhase !== record.phase || closure.reason !== LEGACY_CLOSURE_REASON ||
    closure.chainId !== facts.chainId || closure.account !== facts.account || closure.blockTag !== "finalized" ||
    closure.highestEnvelopeNonceAtomic !== facts.highestNonce.toString() || typeof closure.finalizedNonceAtomic !== "string" ||
    !UINT.test(closure.finalizedNonceAtomic) || BigInt(closure.finalizedNonceAtomic) <= facts.highestNonce ||
    canonicalJson(own.map(item => item?.transactionHash)) !== canonicalJson(facts.ownHashes) ||
    own.some(item => !isPlainRecord(item) || Object.keys(item).length !== 2 || !["not_found", "included"].includes(item.seen as string)) ||
    typeof closure.closedAt !== "string" || !Number.isFinite(Date.parse(closure.closedAt)) ||
    new Date(Date.parse(closure.closedAt)).toISOString() !== closure.closedAt) closureCorrupt("closure_binding");
  return Object.freeze(closure);
}
