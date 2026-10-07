import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { keccak256 } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { directCustodyPayload } from "./direct-public-effect.js";
import type { Hex, OperationRecord } from "./model.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";

/** Permanent dispatch fence. Absence of a receipt never grants another send. */
export class EvmDirectSubmissionJournal extends SecureStateStore {
  async exists(operation: OperationRecord): Promise<boolean> {
    const value = await this.readJson(this.path(operation));
    if (value === null) return false;
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "integrityHash"]) ||
      value.schemaVersion !== "apn.evm-direct-submitting.v1" || value.integrityHash !== hashObject({ schemaVersion: value.schemaVersion, binding: value.binding }) ||
      hashObject(value.binding) !== hashObject(this.binding(operation))) corrupt();
    return true;
  }

  async fence(operation: OperationRecord, raw: Hex): Promise<void> {
    if (operation.state !== "signed_not_submitted" || operation.transactionHash === undefined ||
      operation.rawTransactionHash !== operation.transactionHash || keccak256(raw) !== operation.transactionHash) corrupt();
    const path = this.path(operation);
    await this.ensureDirectory(join("direct-submissions", operation.profileHash));
    // Persist each new directory entry in its parent before publishing the dispatch marker.
    for (const directoryPath of [this.root, join(this.root, "direct-submissions"), join(this.root, "direct-submissions", operation.profileHash)]) {
      const directory = await open(directoryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    }
    const body = { schemaVersion: "apn.evm-direct-submitting.v1", binding: this.binding(operation) };
    // SecureStateStore fsyncs the file, publishes it create-only, then fsyncs the parent directory.
    await this.writeJson(path, { ...body, integrityHash: hashObject(body) }, true);
  }

  private binding(operation: OperationRecord) {
    return { operationId: operation.operationId, profileHash: operation.profileHash, fingerprint: operation.fingerprint,
      signedPayloadHash: hashObject(directCustodyPayload(operation)), transactionHash: operation.transactionHash, rawTransactionHash: operation.rawTransactionHash };
  }
  private path(operation: OperationRecord): string {
    stateIdentifier(operation.profileHash, "submission profile hash"); stateIdentifier(operation.operationId, "submission operation id");
    return join("direct-submissions", operation.profileHash, `${operation.operationId}.json`);
  }
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Generic direct submission fence differs from its frozen signed operation."); }
