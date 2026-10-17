import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { facilitatorFail } from "./failure.js";
import { FACILITATOR_FILE_LIMIT, type FacilitatorOperationRecord } from "./operation-model.js";
import { facilitatorReceipt, type FacilitatorReceipt } from "./receipt.js";
import { facilitatorAtTransition, facilitatorSame, validateFacilitatorContinuity, validateFacilitatorOperation } from "./transitions.js";

const OPERATIONS = "facilitator-gasless-operations";
const RECEIPTS = "facilitator-gasless-receipts";
function corrupt(): never { return facilitatorFail("facilitator_gasless_state_corrupt"); }

export interface FacilitatorGaslessRepositoryPort {
  findOperation(operationId: string): Promise<FacilitatorOperationRecord | null>;
  listOperations(profileHash: string): Promise<readonly FacilitatorOperationRecord[]>;
  listAllOperations(): Promise<readonly FacilitatorOperationRecord[]>;
  persist(op: FacilitatorOperationRecord): Promise<void>;
  loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt>;
}

export class FacilitatorGaslessOperationRepository extends SecureStateStore implements FacilitatorGaslessRepositoryPort {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize(); await this.ensureDirectory(OPERATIONS);
    })();
    await this.initialized;
  }
  async loadOperation(profileHash: string, operationId: string): Promise<FacilitatorOperationRecord | null> {
    const value = await this.readJson(this.path(OPERATIONS, profileHash, operationId));
    if (value === null) return null;
    const op = validateFacilitatorOperation(value);
    if (op.profileHash !== profileHash || op.operationId !== operationId) corrupt();
    return op;
  }
  async findOperation(operationId: string): Promise<FacilitatorOperationRecord | null> {
    stateIdentifier(operationId, "facilitator gasless operation ID");
    const matches = (await this.listAllOperations()).filter((op) => op.operationId === operationId);
    if (matches.length > 1) corrupt();
    return matches[0] ?? null;
  }
  async listOperations(profileHash: string): Promise<readonly FacilitatorOperationRecord[]> {
    stateIdentifier(profileHash, "facilitator gasless profile hash");
    const result: FacilitatorOperationRecord[] = [];
    for (const entry of await this.readDirectory(`${OPERATIONS}/${profileHash}`)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const op = await this.loadOperation(profileHash, entry.name.slice(0, -5));
      if (op === null) corrupt();
      result.push(op);
    }
    return result;
  }
  async listAllOperations(): Promise<readonly FacilitatorOperationRecord[]> {
    const result: FacilitatorOperationRecord[] = [];
    for (const entry of await this.readDirectory(OPERATIONS)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) corrupt();
      result.push(...await this.listOperations(entry.name));
    }
    if (new Set(result.map((op) => op.operationId)).size !== result.length ||
      new Set(result.map((op) => op.idempotencyHash)).size !== result.length) corrupt();
    return result;
  }
  /** Caller holds the profile/operation locks, plus the global idempotency lock for preparation. */
  async writeOperation(input: FacilitatorOperationRecord): Promise<void> {
    const op = validateFacilitatorOperation(input);
    if (Buffer.byteLength(canonicalJson(op), "utf8") + 1 > FACILITATOR_FILE_LIMIT) facilitatorFail("facilitator_gasless_capacity");
    await this.ready();
    const previous = await this.loadOperation(op.profileHash, op.operationId);
    if (previous === null) {
      if (op.state !== "awaiting_approval" || op.transitions.length !== 1) corrupt();
      if ((await this.listAllOperations()).some((candidate) => candidate.operationId === op.operationId ||
        candidate.idempotencyHash === op.idempotencyHash)) corrupt();
    } else {
      validateFacilitatorContinuity(previous, op);
      if (facilitatorSame(previous, op)) return;
    }
    await this.ensureDirectory(`${OPERATIONS}/${op.profileHash}`);
    await this.writeJson(this.path(OPERATIONS, op.profileHash, op.operationId), op);
  }
  /** The operation is the only record written; its receipt is derived from it on read. */
  async persist(op: FacilitatorOperationRecord): Promise<void> {
    await this.writeOperation(op);
  }
  /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
  async loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt> {
    const op = await this.loadOperation(profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "The Avalanche facilitator operation was not found.");
    const value = await this.readJson(this.path(RECEIPTS, profileHash, operationId));
    if (value !== null && receiptTransition(value, op) === op.transitions.length - 1) return value as FacilitatorReceipt;
    return facilitatorReceipt(op);
  }
  private path(root: typeof OPERATIONS | typeof RECEIPTS, profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "facilitator gasless profile hash");
    stateIdentifier(operationId, "facilitator gasless operation ID");
    return `${root}/${profileHash}/${operationId}.json`;
  }
}

/** The transition a stored receipt belongs to: it must equal that transition's exact historical projection. */
function receiptTransition(value: unknown, op: FacilitatorOperationRecord): number {
  if (!isPlainRecord(value) || value.operation_id !== op.operationId || value.fingerprint !== op.fingerprint) corrupt();
  const { receipt_hash, ...body } = value;
  if (hashObject(body) !== receipt_hash) corrupt();
  const index = op.transitions.findIndex((_, i) => facilitatorAtTransition(op, i).integrityHash === value.operation_binding_hash);
  if (index < 0 || !facilitatorSame(value, facilitatorReceipt(facilitatorAtTransition(op, index)))) corrupt();
  return index;
}
