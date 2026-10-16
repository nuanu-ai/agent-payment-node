import { SecureStateStore } from "../secure-state-store.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeSealedMaterial } from "./ports.js";
import type { Hex } from "../model.js";
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
/**
 * Permanent create-only SIGN and SEND barriers for every LI.FI route. They live outside the rollbackable operation and usage
 * journals: SIGN binds the effect before custody signs, SEND binds its exact sealed bytes before the one broadcast. The same
 * claim again is the same effect (a no-op); a different claim for that boundary is refused. A lost result never permits a
 * second, different effect, and a SEND claim the journal has not recorded means "observe, never send again".
 */
export declare class BridgeEffectClaims extends SecureStateStore {
    /** Releasing unsent effects to a terminal state is refused while any of them holds a SEND claim: a broadcast may exist. */
    assertNoUnrecordedSend(op: BridgeOperationRecord): Promise<void>;
    /** The exact sealed bytes this effect's SEND claim bound, or null when no send was ever claimed. */
    sendClaim(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<{
        materialHash: string;
        transactionHash: Hex;
    } | null>;
    claim(op: BridgeOperationRecord, role: "approval" | "bridge", boundary: "sign" | "send", material?: BridgeSealedMaterial): Promise<void>;
    private path;
}
