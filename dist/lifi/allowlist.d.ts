import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type AssetUsageIdentity, type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { RuntimeContext } from "../runtime.js";
import type { BridgeRouteRequest } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
export declare const BRIDGE_ALLOWLIST_SCHEMA: "apn.bridge-allowlist.v1";
export declare const LIFI_ACROSS_BRIDGE_MECHANISM: Readonly<{
    provider: "lifi";
    reference: "across-v4";
}>;
export interface BridgeAllowlistBinding {
    readonly schemaVersion: typeof BRIDGE_ALLOWLIST_SCHEMA;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly account: string;
    readonly chain: string;
    readonly asset: AssetUsageIdentity["asset"];
    readonly amountAtomic: string;
    readonly selfRecipient: string;
    readonly mechanism: typeof LIFI_ACROSS_BRIDGE_MECHANISM;
}
export type BridgeUsageTarget = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert";
export declare class BridgeAllowlistGate {
    private readonly context;
    private readonly ledger;
    constructor(context: Pick<RuntimeContext, "state" | "clock">);
    admit(profile: string, owner: string, request: BridgeRouteRequest, tool: string): Promise<BridgeAllowlistBinding>;
    confirm(profile: string, request: BridgeRouteRequest, tool: string, bindingValue: unknown): Promise<ActiveAssetPolicy>;
    reserve(op: BridgeOperationRecord): Promise<AssetUsageReservation>;
    follow(op: BridgeOperationRecord, target: BridgeUsageTarget): Promise<void>;
    private active;
}
export declare function validateBridgeAllowlistBinding(value: unknown): BridgeAllowlistBinding;
export declare function bridgeUsageTarget(op: BridgeOperationRecord): BridgeUsageTarget;
