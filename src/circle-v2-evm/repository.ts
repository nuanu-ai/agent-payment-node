import { validateKnownCircle, validateCircleFundingOperation, type CircleKnownOperation, type CircleFundingOperationV2 } from "./funding-operation.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { circleCorrupt, circleSame } from "./operation-model.js";

/** All writes require the caller's shared profile, idempotency, operation and owner locks. */
export class CircleRepository extends SecureStateStore {
  async loadAny(operationId: string): Promise<CircleKnownOperation | null> {
    stateIdentifier(operationId, "Circle operation ID");
    const value = await this.readJson(`circle-v2-evm/${operationId}.json`);
    if (value === null) return null;
    const op = validateKnownCircle(value); if (op.operationId !== operationId) circleCorrupt("path_binding"); return op;
  }
  async listAllAny(): Promise<readonly CircleKnownOperation[]> {
    const result: CircleKnownOperation[] = [];
    for (const entry of await this.readDirectory("circle-v2-evm")) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) circleCorrupt("directory_entry");
      const op = await this.loadAny(entry.name.slice(0, -5)); if (op === null) circleCorrupt("disappeared"); result.push(op);
    }
    return result;
  }
  async saveFunding(input: CircleFundingOperationV2): Promise<void> {
    const next = validateCircleFundingOperation(input), previous = await this.loadAny(next.operationId);
    if (previous !== null) {
      if (previous.schemaVersion !== next.schemaVersion) circleCorrupt("operation_schema_replacement");
      if (circleSame(previous, next)) return;
      validateCircleFundingAdvance(previous, next);
    } else if (next.state !== "awaiting_source" || next.transitions.length !== 1 || next.effects.some(e => e.phase !== "prepared")) circleCorrupt("initial_state");
    await this.initialize(); await this.ensureDirectory("circle-v2-evm");
    await this.writeJson(`circle-v2-evm/${next.operationId}.json`, next, previous === null);
  }

}
const phases = { prepared: ["signing_started"], signing_started: ["sealed", "unknown", "abandoned_unsent"], sealed: ["submission_started", "unknown", "abandoned_unsent"],
  // A possibly-sent effect proven never to land (nonce consumed at safe depth, hash and receipt unknown) is abandoned.
  submission_started: ["submitted", "unknown", "confirmed", "reverted", "abandoned_unsent"], submitted: ["unknown", "confirmed", "reverted", "abandoned_unsent"], unknown: ["unknown", "confirmed", "reverted", "abandoned_unsent"], confirmed: [], reverted: [],
  abandoned_unsent: [] } as const;

const fundingImmutable = (op: CircleFundingOperationV2) => ({ schemaVersion: op.schemaVersion, funding: op.funding, feeQuote: op.feeQuote, operationId: op.operationId, profile: op.profile,
  profileHash: op.profileHash, destinationProfile: op.destinationProfile, destinationProfileHash: op.destinationProfileHash,
  idempotencyHash: op.idempotencyHash, requestHash: op.requestHash, fingerprint: op.fingerprint, destinationChain: op.destinationChain,
  sourceCustody: op.sourceCustody, destinationCustody: op.destinationCustody, policies: op.policies, preparedAt: op.preparedAt,
  expiresAt: op.expiresAt, deploymentDigest: op.deploymentDigest, feeQuoteAtomic: op.feeQuoteAtomic });
export function validateCircleFundingAdvance(previous: CircleFundingOperationV2, next: CircleFundingOperationV2): void {
  if (previous.terminal || !circleSame(fundingImmutable(previous), fundingImmutable(next)) || next.transitions.length !== previous.transitions.length + 1 ||
    !circleSame(previous.transitions, next.transitions.slice(0, -1))) circleCorrupt("continuity");
  const { integrityHash: _hash, transitions: _transitions, ...snapshot } = next;
  if (next.transitions.at(-1)!.snapshotHash !== hashObject(snapshot)) circleCorrupt("snapshot_binding");
  for (const old of previous.effects) {
    const effect = next.effects.find(e => e.role === old.role);
    // R4 re-arm: a mint or cleanup proven never to land is replaced by a fresh, unsigned envelope; the transition names it.
    if ((old.role === "mint" || old.role === "cleanup") && old.phase === "abandoned_unsent" && effect?.phase === "prepared" && effect.transactionHash === null &&
      effect.materialHash === null && effect.proof === null && next.transitions.at(-1)!.reason === `${old.role}_fresh_envelope_after_never_landed:${old.transactionHash ?? "none"}`) continue;
    if (effect === undefined || (!circleSame(old.envelope, effect.envelope) && !(old.role === "mint" && old.phase === "prepared" && effect.phase === "prepared")) || old.transactionHash !== null && old.transactionHash !== effect.transactionHash ||
      old.materialHash !== null && old.materialHash !== effect.materialHash || old.phase !== effect.phase && !(phases[old.phase] as readonly string[]).includes(effect.phase)) circleCorrupt("effect_continuity");
    if (old.proof !== null && (effect.proof === null || old.proof.blockHash !== effect.proof.blockHash || old.proof.receiptHash !== effect.proof.receiptHash ||
      old.proof.finalityTag === "finalized" && !circleSame(old.proof, effect.proof))) circleCorrupt("proof_reorg");
  }
  if (previous.source !== null && (next.source === null || previous.source.sourceMessageHash !== next.source.sourceMessageHash || previous.source.blockHash !== next.source.blockHash)) circleCorrupt("source_reorg");
  if (previous.attestation !== null && (next.attestation === null || previous.attestation.nonce !== next.attestation.nonce || previous.attestation.sourceMessageHash !== next.attestation.sourceMessageHash ||
    previous.effects.some(e => e.role === "mint" && e.phase !== "prepared") && !circleSame(previous.attestation, next.attestation))) circleCorrupt("attestation_replacement");
  if (previous.externalFulfillment !== undefined && !circleSame(previous.externalFulfillment, next.externalFulfillment)) circleCorrupt("external_fulfillment_replacement");
  if (previous.destination !== null && !circleSame(previous.destination, next.destination)) circleCorrupt("destination_replacement");
  if (previous.usage.length > 0 && !circleSame(previous.usage.map(x => ({ id: x.reservationId, account: x.account, amount: x.amountAtomic })),
    next.usage.map(x => ({ id: x.reservationId, account: x.account, amount: x.amountAtomic })))) circleCorrupt("usage_replacement");
  if (previous.usageFinalized && !next.usageFinalized) circleCorrupt("usage_regression");
  if (Buffer.byteLength(canonicalJson(next)) > 1024 * 1024) circleCorrupt("capacity");
}
