import { canonicalJson, hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { circleCorrupt, circleSame, validateCircle, type CircleOperationV1 } from "./operation-model.js";

/** All writes require the caller's shared profile, idempotency, operation and owner locks. */
export class CircleRepository extends SecureStateStore {
  async load(operationId: string): Promise<CircleOperationV1 | null> {
    stateIdentifier(operationId, "Circle operation ID");
    const value = await this.readJson(`circle-v2-evm/${operationId}.json`);
    if (value === null) return null;
    const op = validateCircle(value); if (op.operationId !== operationId) circleCorrupt("path_binding"); return op;
  }
  async listAllOperations(): Promise<readonly CircleOperationV1[]> {
    const result: CircleOperationV1[] = [];
    for (const entry of await this.readDirectory("circle-v2-evm")) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) circleCorrupt("directory_entry");
      const op = await this.load(entry.name.slice(0, -5)); if (op === null) circleCorrupt("disappeared"); result.push(op);
    }
    return result;
  }
  async listOperations(profileHash: string): Promise<readonly CircleOperationV1[]> {
    stateIdentifier(profileHash, "Circle profile hash");
    // Both the principal owner and a distinct gas owner hold the operation while unresolved.
    return (await this.listAllOperations()).filter(op => op.profileHash === profileHash || op.destinationProfileHash === profileHash);
  }
  async save(input: CircleOperationV1): Promise<void> {
    const next = validateCircle(input), previous = await this.load(next.operationId);
    if (previous !== null) {
      if (circleSame(previous, next)) return;
      validateCircleAdvance(previous, next);
    } else if (next.state !== "awaiting_source" || next.transitions.length !== 1 || next.effects.some(e => e.phase !== "prepared")) circleCorrupt("initial_state");
    await this.initialize(); await this.ensureDirectory("circle-v2-evm");
    await this.writeJson(`circle-v2-evm/${next.operationId}.json`, next, previous === null);
  }
}
const immutable = (op: CircleOperationV1) => ({ schemaVersion: op.schemaVersion, operationId: op.operationId, profile: op.profile,
  profileHash: op.profileHash, destinationProfile: op.destinationProfile, destinationProfileHash: op.destinationProfileHash,
  idempotencyHash: op.idempotencyHash, requestHash: op.requestHash, fingerprint: op.fingerprint, destinationChain: op.destinationChain,
  sourceCustody: op.sourceCustody, destinationCustody: op.destinationCustody, policies: op.policies, preparedAt: op.preparedAt,
  expiresAt: op.expiresAt, deploymentDigest: op.deploymentDigest, feeQuoteAtomic: op.feeQuoteAtomic });
const phases = { prepared: ["signing_started"], signing_started: ["sealed", "unknown"], sealed: ["submission_started", "unknown"],
  submission_started: ["submitted", "unknown", "confirmed", "reverted"], submitted: ["unknown", "confirmed", "reverted"], unknown: ["unknown", "confirmed", "reverted"], confirmed: [], reverted: [] } as const;
export function validateCircleAdvance(previous: CircleOperationV1, next: CircleOperationV1): void {
  if (previous.terminal || !circleSame(immutable(previous), immutable(next)) || next.transitions.length !== previous.transitions.length + 1 ||
    !circleSame(previous.transitions, next.transitions.slice(0, -1))) circleCorrupt("continuity");
  const { integrityHash: _hash, transitions: _transitions, ...snapshot } = next;
  if (next.transitions.at(-1)!.snapshotHash !== hashObject(snapshot)) circleCorrupt("snapshot_binding");
  for (const old of previous.effects) {
    const effect = next.effects.find(e => e.role === old.role);
    if (effect === undefined || (!circleSame(old.envelope, effect.envelope) && !(old.role === "mint" && old.phase === "prepared" && effect.phase === "prepared")) || old.transactionHash !== null && old.transactionHash !== effect.transactionHash ||
      old.materialHash !== null && old.materialHash !== effect.materialHash || old.phase !== effect.phase && !(phases[old.phase] as readonly string[]).includes(effect.phase)) circleCorrupt("effect_continuity");
    if (old.proof !== null && (effect.proof === null || old.proof.blockHash !== effect.proof.blockHash || old.proof.receiptHash !== effect.proof.receiptHash ||
      old.proof.finalityTag === "finalized" && !circleSame(old.proof, effect.proof))) circleCorrupt("proof_reorg");
  }
  if (previous.source !== null && (next.source === null || previous.source.sourceMessageHash !== next.source.sourceMessageHash || previous.source.blockHash !== next.source.blockHash)) circleCorrupt("source_reorg");
  if (previous.attestation !== null && (next.attestation === null || previous.attestation.nonce !== next.attestation.nonce || previous.attestation.sourceMessageHash !== next.attestation.sourceMessageHash ||
    previous.effects.some(e => e.role === "mint" && e.phase !== "prepared") && !circleSame(previous.attestation, next.attestation))) circleCorrupt("attestation_replacement");
  if (previous.destination !== null && !circleSame(previous.destination, next.destination)) circleCorrupt("destination_replacement");
  if (previous.usage.length > 0 && !circleSame(previous.usage.map(x => ({ id: x.reservationId, account: x.account, amount: x.amountAtomic })),
    next.usage.map(x => ({ id: x.reservationId, account: x.account, amount: x.amountAtomic })))) circleCorrupt("usage_replacement");
  if (previous.externalFulfillment !== undefined && !circleSame(previous.externalFulfillment, next.externalFulfillment)) circleCorrupt("external_fulfillment_replacement");
  if (previous.nonceRetirement !== undefined && !circleSame(previous.nonceRetirement, next.nonceRetirement)) circleCorrupt("retirement_replacement");
  if (previous.usageFinalized && !next.usageFinalized) circleCorrupt("usage_regression");
  if (Buffer.byteLength(canonicalJson(next)) > 1024 * 1024) circleCorrupt("capacity");
}
