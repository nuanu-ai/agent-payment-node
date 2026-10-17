import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import { assertBridgeAppend, bridgeCorrupt, validateBridgeOperation } from "./operation-validation.js";
import { bridgeReceipt, currentBridgeReceiptCandidates, type BridgeReceipt } from "./receipt.js";
import { legacyBridgeReceiptCandidates } from "./receipt.js";
import { bridgeAtTransition } from "./transitions.js";
import { bridgeFailure, bridgeSame } from "./validation.js";
import { adaptLegacyBridgeOperation, isLegacyBridgeOperation,
  type LegacyBridgeOperationRecord, type StoredBridgeOperationRecord } from "./legacy-operation.js";

export class BridgeOperationRepository extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize(); await this.ensureDirectory("bridge-operations");
    })();
    await this.initialized;
  }
  async loadOperation(profileHash: string, operationId: string): Promise<BridgeOperationRecord | null> {
    const stored = await this.loadStoredOperation(profileHash, operationId);
    if (stored === null) return null;
    if (isLegacyBridgeOperation(stored)) bridgeCorrupt();
    return stored;
  }
  async loadStoredOperation(profileHash: string, operationId: string): Promise<StoredBridgeOperationRecord | null> {
    const value = await this.readJson(this.path("bridge-operations", profileHash, operationId));
    if (value === null) return null;
    let op: StoredBridgeOperationRecord;
    try { op = validateBridgeOperation(value); } catch (error) {
      if (!(error instanceof ApnError) || error.code !== "APN_STATE_CORRUPT") throw error;
      op = adaptLegacyBridgeOperation(value);
    }
    if (op.profileHash !== profileHash || op.operationId !== operationId) bridgeCorrupt();
    return op;
  }
  async findStoredOperation(operationId: string): Promise<StoredBridgeOperationRecord | null> {
    stateIdentifier(operationId, "bridge operation ID");
    return await this.findInProfiles("bridge-operations", async (profileHash) => await this.loadStoredOperation(profileHash, operationId), bridgeCorrupt);
  }
  async findOperation(operationId: string): Promise<BridgeOperationRecord | null> {
    const stored = await this.findStoredOperation(operationId);
    if (stored === null) return null;
    if (isLegacyBridgeOperation(stored)) bridgeCorrupt();
    return stored;
  }
  async writeOperation(op: BridgeOperationRecord): Promise<void> {
    validateBridgeOperation(op); await this.ready();
    if (Buffer.byteLength(canonicalJson(op), "utf8") + 1 > 1024 * 1024) bridgeFailure("APN_OPERATION_BLOCKED", "bridge_record_capacity");
    // `op` is validated above and `previous` when it is loaded; only the append structure remains to check.
    const previous = await this.loadOperation(op.profileHash, op.operationId);
    if (previous !== null) assertBridgeAppend(previous, op);
    else if (op.state !== "awaiting_approval" || op.transitions.length !== 1) bridgeCorrupt();
    if (previous !== null && bridgeSame(previous, op)) return;
    await this.ensureDirectory(`bridge-operations/${op.profileHash}`);
    await this.writeJson(this.path("bridge-operations", op.profileHash, op.operationId), op);
  }
  /** Caller holds the same profile/operation locks as every other money service. Its receipt is derived on read. */
  async persist(op: BridgeOperationRecord): Promise<void> {
    await this.writeOperation(op);
  }
  /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
  async loadReceipt(profileHash: string, operationId: string): Promise<BridgeReceipt> {
    const op = await this.loadOperation(profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "The bridge operation was not found.");
    const value = await this.readJson(this.path("bridge-receipts", profileHash, operationId));
    if (value !== null && receiptTransition(value, op) === op.transitions.length - 1) return value as BridgeReceipt;
    return bridgeReceipt(op);
  }
  async loadLegacyReceipt(op: LegacyBridgeOperationRecord): Promise<Record<string, unknown>> {
    const value = await this.readJson(this.path("bridge-receipts", op.profileHash, op.operationId));
    if (!isPlainRecord(value) || !legacyBridgeReceiptCandidates(op).some((candidate) => bridgeSame(value, candidate))) bridgeCorrupt();
    return value;
  }
  private path(root: "bridge-operations" | "bridge-receipts", profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "bridge profile hash"); stateIdentifier(operationId, "bridge operation ID");
    return `${root}/${profileHash}/${operationId}.json`;
  }
}
/** The transition a stored receipt binds; corrupt unless it is one of that transition's receipt shapes. */
function receiptTransition(value: unknown, op: BridgeOperationRecord): number {
  if (!isPlainRecord(value) || value.operation_id !== op.operationId || value.fingerprint !== op.fingerprint) bridgeCorrupt();
  const { receipt_hash, ...body } = value;
  if (hashObject(body) !== receipt_hash) bridgeCorrupt();
  // A stored receipt binds the newest transitions; search from the end (an integrity hash names exactly one transition).
  const index = op.transitions.findLastIndex((_, i) => bridgeAtTransition(op, i).integrityHash === value.operation_binding_hash);
  if (index < 0 || !currentBridgeReceiptCandidates(bridgeAtTransition(op, index))
    .some((candidate) => bridgeSame(value, candidate))) bridgeCorrupt();
  return index;
}
