import { ApnError } from "./errors.js";
import type { OperationService, StoredMoneyOperation } from "./operation-service.js";

type PrepareIdentity = Parameters<OperationService["resolvePrepare"]>[0];

/**
 * Provider prepares are identified without the RPC URL: any endpoint of the bound chain may prepare,
 * approve and observe them. Records prepared while the URL was part of the request hash still replay
 * through that legacy hash, so the same key never becomes a conflict.
 */
export async function resolveProviderPrepare(
  operations: OperationService,
  input: PrepareIdentity,
  legacyRequestHash: string,
): Promise<StoredMoneyOperation | null> {
  try { return await operations.resolvePrepare(input); }
  catch (error) {
    if (!(error instanceof ApnError) || error.code !== "APN_IDEMPOTENCY_CONFLICT") throw error;
    return await operations.resolvePrepare({ ...input, requestHash: legacyRequestHash });
  }
}
