import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { SA_FILE_LIMIT, type SmartAccountGaslessOperationRecord, type SmartAccountGaslessReceipt } from "./operation-model.js";
import type { SmartAccountGaslessRepositoryPort } from "./ports.js";
import { saFail } from "./reasons.js";
import { saSame } from "./integrity.js";
import { smartAccountGaslessReceipt, validateSmartAccountGaslessReceipt } from "./receipt.js";
import { validateSmartAccountGaslessContinuity, validateSmartAccountGaslessOperation } from "./transitions.js";

const OPERATIONS = "smart-account-gasless-operations";
const RECEIPTS = "smart-account-gasless-receipts";
function corrupt(): never { return saFail("sa_gasless_state_corrupt"); }

export class SmartAccountGaslessOperationRepository extends SecureStateStore implements SmartAccountGaslessRepositoryPort {
  private initialized: Promise<void> | undefined;
  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize(); await this.ensureDirectory(OPERATIONS);
    })();
    await this.initialized;
  }
  async loadOperation(profileHash: string, operationId: string): Promise<SmartAccountGaslessOperationRecord | null> {
    const value = await this.readJson(this.path(OPERATIONS, profileHash, operationId));
    if (value === null) return null;
    const op = validateSmartAccountGaslessOperation(value);
    if (op.profileHash !== profileHash || op.operationId !== operationId) corrupt();
    return op;
  }
  /** Reads only files named by this ID, so another saved operation can never break this lookup. */
  async findOperation(operationId: string): Promise<SmartAccountGaslessOperationRecord | null> {
    stateIdentifier(operationId, "Smart Account gasless operation ID");
    const matches: SmartAccountGaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory(OPERATIONS)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) corrupt();
      const op = await this.loadOperation(entry.name, operationId);
      if (op !== null) matches.push(op);
    }
    if (matches.length > 1) corrupt();
    return matches[0] ?? null;
  }
  async listOperations(profileHash: string): Promise<readonly SmartAccountGaslessOperationRecord[]> {
    stateIdentifier(profileHash, "Smart Account gasless profile hash");
    const result: SmartAccountGaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory(`${OPERATIONS}/${profileHash}`)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const op = await this.loadOperation(profileHash, entry.name.slice(0, -5));
      if (op === null) corrupt();
      result.push(op);
    }
    return result;
  }
  async listAllOperations(): Promise<readonly SmartAccountGaslessOperationRecord[]> {
    const result: SmartAccountGaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory(OPERATIONS)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) corrupt();
      result.push(...await this.listOperations(entry.name));
    }
    if (new Set(result.map(op => op.operationId)).size !== result.length ||
      new Set(result.map(op => op.idempotencyHash)).size !== result.length) corrupt();
    return result;
  }
  /** Caller holds the existing profile/operation locks, plus global idempotency lock for preparation. */
  async writeOperation(input: SmartAccountGaslessOperationRecord): Promise<void> {
    const op = validateSmartAccountGaslessOperation(input);
    if (Buffer.byteLength(canonicalJson(op), "utf8") + 1 > SA_FILE_LIMIT) saFail("sa_gasless_capacity");
    await this.ready();
    const previous = await this.loadOperation(op.profileHash, op.operationId);
    if (previous === null) {
      if (op.state !== "awaiting_approval" || op.transitions.length !== 1) corrupt();
      if ((await this.listAllOperations()).some(candidate => candidate.operationId === op.operationId ||
        candidate.idempotencyHash === op.idempotencyHash)) corrupt();
    } else {
      validateSmartAccountGaslessContinuity(previous, op);
      if (saSame(previous, op)) return;
    }
    await this.ensureDirectory(`${OPERATIONS}/${op.profileHash}`);
    await this.writeJson(this.path(OPERATIONS, op.profileHash, op.operationId), op);
  }
  /** The operation is the only record written; its receipt is derived from it on read. */
  async persist(op: SmartAccountGaslessOperationRecord): Promise<void> {
    await this.writeOperation(op);
  }
  /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
  async loadReceipt(profileHash: string, operationId: string): Promise<SmartAccountGaslessReceipt> {
    const op = await this.loadOperation(profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "The Smart Account gasless operation was not found.");
    const value = await this.readJson(this.path(RECEIPTS, profileHash, operationId));
    const stored = value === null ? null : validateSmartAccountGaslessReceipt(value, op);
    return stored !== null && stored.transition_hash === op.transitions.at(-1)!.transitionHash ? stored : smartAccountGaslessReceipt(op);
  }
  private path(root: typeof OPERATIONS | typeof RECEIPTS, profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "Smart Account gasless profile hash");
    stateIdentifier(operationId, "Smart Account gasless operation ID");
    return `${root}/${profileHash}/${operationId}.json`;
  }
}
