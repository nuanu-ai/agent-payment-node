import type { OperationService, StoredMoneyOperation } from "./operation-service.js";
type PrepareIdentity = Parameters<OperationService["resolvePrepare"]>[0];
/**
 * Provider prepares are identified without the RPC URL: any endpoint of the bound chain may prepare,
 * approve and observe them. Records prepared while the URL was part of the request hash still replay
 * through that legacy hash, so the same key never becomes a conflict.
 */
export declare function resolveProviderPrepare(operations: OperationService, input: PrepareIdentity, legacyRequestHash: string): Promise<StoredMoneyOperation | null>;
export {};
