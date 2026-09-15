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
  repairReceipt(op: FacilitatorOperationRecord): Promise<void>;
  loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt>;
}

export class FacilitatorGaslessOperationRepository extends SecureStateStore implements FacilitatorGaslessRepositoryPort {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize(); await this.ensureDirectory(OPERATIONS); await this.ensureDirectory(RECEIPTS);
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
  async persist(op: FacilitatorOperationRecord): Promise<void> {
    await this.writeOperation(op);
    await this.repairReceipt(op);
  }
  async repairReceipt(input: FacilitatorOperationRecord): Promise<void> {
    const op = validateFacilitatorOperation(input);
    await this.ready();
    const stored = await this.loadOperation(op.profileHash, op.operationId);
    if (stored === null || !facilitatorSame(stored, op)) corrupt();
    const path = this.path(RECEIPTS, op.profileHash, op.operationId), previous = await this.readJson(path);
    if (previous !== null) validateReceipt(previous, op);
    const receipt = facilitatorReceipt(op);
    if (facilitatorSame(previous, receipt)) return;
    await this.ensureDirectory(`${RECEIPTS}/${op.profileHash}`);
    await this.writeJson(path, receipt);
  }
  async loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt> {
    const op = await this.loadOperation(profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "The Avalanche facilitator operation was not found.");
    const value = await this.readJson(this.path(RECEIPTS, profileHash, operationId));
    if (value !== null) validateReceipt(value, op);
    if (value === null || !facilitatorSame(value, facilitatorReceipt(op))) {
      throw new ApnError("APN_OPERATION_BLOCKED", "The Avalanche facilitator receipt needs recovery from its saved operation.",
        { reason: "facilitator_gasless_receipt", operationId, nextActions: [`apn operation resume --operation ${operationId}`] });
    }
    return value as FacilitatorReceipt;
  }
  private path(root: typeof OPERATIONS | typeof RECEIPTS, profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "facilitator gasless profile hash");
    stateIdentifier(operationId, "facilitator gasless operation ID");
    return `${root}/${profileHash}/${operationId}.json`;
  }
}

/** A stale receipt must equal the exact historical projection of one earlier transition. */
function validateReceipt(value: unknown, op: FacilitatorOperationRecord): void {
  if (!isPlainRecord(value) || value.operation_id !== op.operationId || value.fingerprint !== op.fingerprint) corrupt();
  const { receipt_hash, ...body } = value;
  if (hashObject(body) !== receipt_hash) corrupt();
  const index = op.transitions.findIndex((_, i) => facilitatorAtTransition(op, i).integrityHash === value.operation_binding_hash);
  if (index < 0 || !facilitatorSame(value, facilitatorReceipt(facilitatorAtTransition(op, index)))) corrupt();
}
