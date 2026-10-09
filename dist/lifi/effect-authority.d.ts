import { SecureStateStore } from "../secure-state-store.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeSealedMaterial } from "./ports.js";
export type BridgeAuthorityCheck = () => Promise<void>;
export declare function guardedWbtc(op: Pick<BridgeOperationRecord, "intent">): boolean;
export declare function bridgeEffectBinding(op: BridgeOperationRecord, role: "approval" | "bridge"): string;
export declare function assertBridgeSignGrant(check: BridgeAuthorityCheck | undefined, op: BridgeOperationRecord, role: "approval" | "bridge"): asserts check is BridgeAuthorityCheck;
export declare function assertBridgeSignImmediate(check: BridgeAuthorityCheck): void;
export declare function assertBridgePhysicalGrant(check: BridgeAuthorityCheck | undefined, raw: unknown): asserts check is BridgeAuthorityCheck;
export interface BridgeEffectAuthority {
    check(op: BridgeOperationRecord): Promise<void>;
    sign(op: BridgeOperationRecord, role: "approval" | "bridge"): BridgeAuthorityCheck;
    send(op: BridgeOperationRecord, material: BridgeSealedMaterial): BridgeAuthorityCheck;
}
/** The approval completion instant and controller are invocation-private, never reconstructed from a journal. */
export declare function withBridgeEffectAuthority<T>(op: BridgeOperationRecord, now: () => number, foregroundConfirm: () => Promise<boolean>, rejected: () => Promise<T>, confirmPolicy: (op: BridgeOperationRecord) => Promise<string | undefined>, work: (authority: BridgeEffectAuthority, approvedAt: number) => Promise<T>): Promise<T>;
/** Permanent create-only barriers live outside rollbackable operation/usage journals. A lost result never permits another effect. */
export declare class BridgeEffectClaims extends SecureStateStore {
    claim(op: BridgeOperationRecord, role: "approval" | "bridge", boundary: "sign" | "send", material?: BridgeSealedMaterial): Promise<void>;
}
