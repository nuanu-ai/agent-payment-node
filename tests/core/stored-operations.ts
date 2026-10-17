import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { GaslessOperationRepository } from "../../src/gasless/operation-repository.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { BridgeOperationRepository } from "../../src/lifi/operation-repository.js";
import type { RailOperationRecord } from "../../src/rail-operation-model.js";
import { RailOperationRepository } from "../../src/rail-operation-repository.js";

/**
 * A test's lookup of a rail, gasless or bridge record by its ID alone, under whichever profile directory holds it,
 * through the family's own reader (a legacy bridge journal throws, as the live reader does). Production code finds
 * records through the operation index.
 */
export async function findStored(records: RailOperationRepository, operationId: string): Promise<RailOperationRecord | null>;
export async function findStored(records: GaslessOperationRepository, operationId: string): Promise<GaslessOperationRecord | null>;
export async function findStored(records: BridgeOperationRepository, operationId: string): Promise<BridgeOperationRecord | null>;
export async function findStored(records: RailOperationRepository | GaslessOperationRepository | BridgeOperationRepository,
  operationId: string): Promise<RailOperationRecord | GaslessOperationRecord | BridgeOperationRecord | null> {
  assert.match(operationId, /^[a-f0-9]{64}$/u);
  const directory = records instanceof RailOperationRepository ? "rail-operations"
    : records instanceof GaslessOperationRepository ? "gasless-operations" : "bridge-operations";
  let profiles: string[];
  try { profiles = (await readdir(join(records.root, directory))).filter(name => /^[a-f0-9]{64}$/u.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let found: RailOperationRecord | GaslessOperationRecord | BridgeOperationRecord | null = null;
  for (const profileHash of profiles) {
    const record = await records.loadOperation(profileHash, operationId);
    if (record === null) continue;
    assert.equal(found, null, "one record per operation ID");
    found = record;
  }
  return found;
}
