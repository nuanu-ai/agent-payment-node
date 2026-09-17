import type { CommandRequest } from "./commands.js";
import { type AllowlistInventory, type CandidateKind, type CandidateRail } from "./allowlist-inventory.js";
import { type AssetPolicyRegistry } from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";
export declare const ALLOWLIST_POLICY_OVERLAY_SCHEMA: "apn.allowlist-policy-overlay.v1";
export declare const ALLOWLIST_POLICY_RECORD_SCHEMA: "apn.allowlist-policy-record.v1";
export interface AllowlistMechanismPin {
    readonly provider: string;
    readonly reference: string;
}
export interface AllowlistPolicyAdmissionInput {
    readonly chain: string;
    readonly kind: CandidateKind;
    readonly identifier?: string;
    readonly rail: CandidateRail;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly mechanism?: AllowlistMechanismPin;
}
export interface AllowlistPolicyOverlayInput {
    readonly overlayVersion: string;
    readonly profile: string;
    readonly account: string;
    readonly datasetVersion: string;
    readonly datasetSha256: string;
    readonly inventorySha256: string;
    readonly effectiveAt: string;
    readonly expiresAt?: string;
    readonly admissions: readonly AllowlistPolicyAdmissionInput[];
}
export interface AllowlistPolicyOverlay extends AllowlistPolicyOverlayInput {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_OVERLAY_SCHEMA;
    readonly profileHash: string;
    readonly overlayDigest: string;
}
export interface AllowlistPolicyRecord {
    readonly schemaVersion: typeof ALLOWLIST_POLICY_RECORD_SCHEMA;
    readonly revision: number;
    readonly status: "staged_unadmitted";
    readonly preparedAt: string;
    readonly overlay: AllowlistPolicyOverlay;
    readonly registry: AssetPolicyRegistry;
    readonly recordDigest: string;
}
export interface PrepareAllowlistPolicyInput extends AllowlistPolicyOverlayInput {
    readonly expectedRevision?: number;
    readonly now: Date;
}
export declare function compileAllowlistPolicyOverlay(raw: AllowlistPolicyOverlayInput, inventory?: AllowlistInventory): {
    readonly overlay: AllowlistPolicyOverlay;
    readonly registry: AssetPolicyRegistry;
};
export declare function validateAllowlistPolicyRecord(value: unknown): AllowlistPolicyRecord;
export declare class AllowlistPolicyStore extends SecureStateStore {
    private initialized;
    prepare(input: PrepareAllowlistPolicyInput): Promise<AllowlistPolicyRecord>;
    status(profile: string): Promise<AllowlistPolicyRecord | null>;
    private latest;
    private path;
    private ready;
}
export declare function executeAllowlistPolicyCommand(request: Extract<CommandRequest, {
    command: "allowlist.policy.prepare" | "allowlist.policy.status";
}>, stateRoot: string, now: Date): Promise<unknown>;
