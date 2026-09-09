import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import { gaslessCorrupt, validateGaslessContinuity, validateGaslessOperation } from "./operation-validation.js";
import { gaslessReceipt, type GaslessReceipt } from "./receipt.js";
import { gaslessAtTransition } from "./transitions.js";
import { gaslessFailure, gaslessSame } from "./validation.js";

export class GaslessOperationRepository extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize(); await this.ensureDirectory("gasless-operations"); await this.ensureDirectory("gasless-receipts");
    })();
    await this.initialized;
  }
  async loadOperation(profileHash: string, operationId: string): Promise<GaslessOperationRecord | null> {
    const value = await this.readJson(this.path("gasless-operations", profileHash, operationId));
    if (value === null) return null;
    const op = validateGaslessOperation(value);
    if (op.profileHash !== profileHash || op.operationId !== operationId) gaslessCorrupt();
    return op;
  }
  async findOperation(operationId: string): Promise<GaslessOperationRecord | null> {
    stateIdentifier(operationId, "gasless operation ID");
    const matches = (await this.listAllOperations()).filter((op) => op.operationId === operationId);
    if (matches.length > 1) gaslessCorrupt();
    return matches[0] ?? null;
  }
  async listOperations(profileHash: string): Promise<readonly GaslessOperationRecord[]> {
    stateIdentifier(profileHash, "gasless profile hash");
    const directory = `gasless-operations/${profileHash}`;
    const result: GaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory(directory)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) gaslessCorrupt();
      const op = await this.loadOperation(profileHash, entry.name.slice(0, -5));
      if (op === null) gaslessCorrupt(); result.push(op);
    }
    return result;
  }
  async listAllOperations(): Promise<readonly GaslessOperationRecord[]> {
    const result: GaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory("gasless-operations")) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) gaslessCorrupt();
      result.push(...await this.listOperations(entry.name));
    }
    if (new Set(result.map((op) => op.operationId)).size !== result.length) gaslessCorrupt();
    return result;
  }
  async writeOperation(op: GaslessOperationRecord): Promise<void> {
    validateGaslessOperation(op); await this.ready();
    if (Buffer.byteLength(canonicalJson(op), "utf8") + 1 > 1024 * 1024) gaslessFailure("APN_OPERATION_BLOCKED", "gasless_record_capacity");
    const previous = await this.loadOperation(op.profileHash, op.operationId);
    if (previous !== null) validateGaslessContinuity(previous, op);
    else if (op.state !== "awaiting_approval" || op.transitions.length !== 1) gaslessCorrupt();
    if (previous !== null && gaslessSame(previous, op)) return;
    await this.ensureDirectory(`gasless-operations/${op.profileHash}`);
    await this.writeJson(this.path("gasless-operations", op.profileHash, op.operationId), op);
  }
  /** Caller holds the same profile/operation locks as all money families. */
  async persist(op: GaslessOperationRecord): Promise<void> {
    await this.writeOperation(op); await this.repairReceipt(op);
  }
  async repairReceipt(op: GaslessOperationRecord): Promise<void> {
    await this.ready();
    const stored = await this.loadOperation(op.profileHash, op.operationId);
    if (stored === null || !gaslessSame(stored, op)) gaslessCorrupt();
    const path = this.path("gasless-receipts", op.profileHash, op.operationId), previous = await this.readJson(path);
    if (previous !== null) validateReceipt(previous, op);
    const receipt = gaslessReceipt(op); if (gaslessSame(previous, receipt)) return;
    await this.ensureDirectory(`gasless-receipts/${op.profileHash}`); await this.writeJson(path, receipt);
  }
  async loadReceipt(profileHash: string, operationId: string): Promise<GaslessReceipt> {
    const op = await this.loadOperation(profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "The gasless operation was not found.");
    const value = await this.readJson(this.path("gasless-receipts", profileHash, operationId));
    if (value !== null) validateReceipt(value, op);
    if (value === null || !gaslessSame(value, gaslessReceipt(op))) throw new ApnError("APN_OPERATION_BLOCKED", "The gasless receipt needs recovery from its saved operation.", {
      operationId, nextActions: [`apn operation resume --operation ${operationId}`],
    });
    return value as GaslessReceipt;
  }
  private path(root: "gasless-operations" | "gasless-receipts", profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "gasless profile hash"); stateIdentifier(operationId, "gasless operation ID");
    return `${root}/${profileHash}/${operationId}.json`;
  }
}
function validateReceipt(value: unknown, op: GaslessOperationRecord): void {
  if (!isPlainRecord(value) || value.operation_id !== op.operationId || value.fingerprint !== op.fingerprint ||
    !gaslessSame(Object.keys(value).sort(), Object.keys(gaslessReceipt(op)).sort())) gaslessCorrupt();
  const { receipt_hash, ...body } = value;
  if (hashObject(body) !== receipt_hash) gaslessCorrupt();
  const index = op.transitions.findIndex((_, i) => gaslessAtTransition(op, i).integrityHash === value.operation_binding_hash);
  if (index < 0 || !gaslessSame(value, gaslessReceipt(gaslessAtTransition(op, index)))) gaslessCorrupt();
}
