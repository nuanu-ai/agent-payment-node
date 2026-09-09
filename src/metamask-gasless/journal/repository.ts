import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { MM_FILE_LIMIT, type MetaMaskGaslessOperationRecord, type MetaMaskGaslessReceipt } from "../operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "../ports.js";
import { mmFail } from "../reasons.js";
import { mmSame } from "../validation.js";
import { metaMaskGaslessReceipt, validateMetaMaskGaslessReceipt } from "./receipt.js";
import { validateMetaMaskGaslessContinuity, validateMetaMaskGaslessOperation } from "./validation.js";

const OPERATIONS = "metamask-gasless-operations";
const RECEIPTS = "metamask-gasless-receipts";

function corrupt(): never { return mmFail("mm_gasless_state_corrupt"); }
function capacity(): never { return mmFail("mm_gasless_record_capacity"); }

export class MetaMaskGaslessOperationRepository extends SecureStateStore implements MetaMaskGaslessRepositoryPort {
  private initialized: Promise<void> | undefined;

  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize();
      await this.ensureDirectory(OPERATIONS);
      await this.ensureDirectory(RECEIPTS);
    })();
    await this.initialized;
  }

  async loadOperation(profileHash: string, operationId: string): Promise<MetaMaskGaslessOperationRecord | null> {
    const value = await this.readJson(this.path(OPERATIONS, profileHash, operationId));
    if (value === null) return null;
    const operation = validateMetaMaskGaslessOperation(value);
    if (operation.profileHash !== profileHash || operation.operationId !== operationId) corrupt();
    return operation;
  }

  async findOperation(operationId: string): Promise<MetaMaskGaslessOperationRecord | null> {
    stateIdentifier(operationId, "MetaMask gasless operation ID");
    const matches = (await this.listAllOperations()).filter(operation => operation.operationId === operationId);
    if (matches.length > 1) corrupt();
    return matches[0] ?? null;
  }

  async listOperations(profileHash: string): Promise<readonly MetaMaskGaslessOperationRecord[]> {
    stateIdentifier(profileHash, "MetaMask gasless profile hash");
    const directory = `${OPERATIONS}/${profileHash}`;
    const result: MetaMaskGaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory(directory)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const operation = await this.loadOperation(profileHash, entry.name.slice(0, -5));
      if (operation === null) corrupt();
      result.push(operation);
    }
    return result;
  }

  async listAllOperations(): Promise<readonly MetaMaskGaslessOperationRecord[]> {
    const result: MetaMaskGaslessOperationRecord[] = [];
    for (const entry of await this.readDirectory(OPERATIONS)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) corrupt();
      result.push(...await this.listOperations(entry.name));
    }
    if (new Set(result.map(operation => operation.operationId)).size !== result.length ||
      new Set(result.map(operation => operation.idempotencyHash)).size !== result.length) corrupt();
    return result;
  }

  async writeOperation(operationInput: MetaMaskGaslessOperationRecord): Promise<void> {
    const operation = validateMetaMaskGaslessOperation(operationInput);
    if (Buffer.byteLength(canonicalJson(operation), "utf8") + 1 > MM_FILE_LIMIT) capacity();
    await this.ready();
    const previous = await this.loadOperation(operation.profileHash, operation.operationId);
    if (previous === null) {
      if (operation.state !== "awaiting_approval" || operation.transitions.length !== 1) corrupt();
      const duplicate = (await this.listAllOperations()).find(candidate =>
        candidate.operationId === operation.operationId || candidate.idempotencyHash === operation.idempotencyHash);
      if (duplicate !== undefined) corrupt();
    } else {
      validateMetaMaskGaslessContinuity(previous, operation);
      if (mmSame(previous, operation)) return;
    }
    await this.ensureDirectory(`${OPERATIONS}/${operation.profileHash}`);
    await this.writeJson(this.path(OPERATIONS, operation.profileHash, operation.operationId), operation);
  }

  /** Caller holds the shared profile and operation locks. The operation is always authoritative. */
  async persist(operation: MetaMaskGaslessOperationRecord): Promise<void> {
    await this.writeOperation(operation);
    await this.repairReceipt(operation);
  }

  async repairReceipt(operationInput: MetaMaskGaslessOperationRecord): Promise<void> {
    await this.ready();
    const operation = validateMetaMaskGaslessOperation(operationInput);
    const stored = await this.loadOperation(operation.profileHash, operation.operationId);
    if (stored === null || !mmSame(stored, operation)) corrupt();
    const path = this.path(RECEIPTS, operation.profileHash, operation.operationId);
    const previous = await this.readJson(path);
    if (previous !== null) validateMetaMaskGaslessReceipt(previous, operation);
    const receipt = metaMaskGaslessReceipt(operation);
    if (mmSame(previous, receipt)) return;
    await this.ensureDirectory(`${RECEIPTS}/${operation.profileHash}`);
    await this.writeJson(path, receipt);
  }

  async loadReceipt(profileHash: string, operationId: string): Promise<MetaMaskGaslessReceipt> {
    const operation = await this.loadOperation(profileHash, operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "The MetaMask gasless operation was not found.");
    const value = await this.readJson(this.path(RECEIPTS, profileHash, operationId));
    if (value !== null) validateMetaMaskGaslessReceipt(value, operation);
    const expected = metaMaskGaslessReceipt(operation);
    if (value === null || !mmSame(value, expected)) {
      throw new ApnError("APN_OPERATION_BLOCKED", "The MetaMask gasless receipt needs recovery from its saved operation.",
        { reason: "mm_gasless_pending", operationId, nextActions: [`apn operation resume --operation ${operationId}`] });
    }
    return value as MetaMaskGaslessReceipt;
  }

  private path(root: typeof OPERATIONS | typeof RECEIPTS, profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "MetaMask gasless profile hash");
    stateIdentifier(operationId, "MetaMask gasless operation ID");
    return `${root}/${profileHash}/${operationId}.json`;
  }
}
