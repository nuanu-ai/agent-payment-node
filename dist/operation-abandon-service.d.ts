import { type RailOperationRecord } from "./rail-operation-model.js";
import type { RailOperationService } from "./rail-operation-service.js";
import type { RuntimeContext } from "./runtime.js";
/**
 * The owner exits of the direct EVM and direct rail families (phase 4b: `apn operation abandon` reaches them through
 * their operation-index adapters). Each re-reads its operation under its own locks and asks for TTY consent.
 */
export declare function abandonDirectTransfer(context: RuntimeContext, operationId: string): Promise<unknown>;
/** A local Solana or TRON transfer whose validity window passed with no RPC history. */
export declare function abandonRailTransfer(context: RuntimeContext, rails: RailOperationService, operation: RailOperationRecord): Promise<unknown>;
