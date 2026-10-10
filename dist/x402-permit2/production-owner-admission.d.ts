import type { StateStore } from "../state.js";
import type { OperationService } from "../operation-service.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
/** Caller holds the existing profile/operation/account locks; common usage was sampled outside them. */
export declare function assertPermit2OwnerLocked(state: StateStore, operations: OperationService, record: Permit2ProductionRecord, now: Date, usage: string): Promise<import("../allowlist-active-policy.js").ActiveAssetPolicy>;
