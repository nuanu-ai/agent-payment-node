import { SecureStateStore } from "../secure-state-store.js";
import type { ClockPort } from "../ports.js";
import { PERMIT2_PRODUCTION_SCHEMA, type Permit2ProductionMaterial } from "./production-material.js";
export type Permit2ProductionState = "prepared" | "reserving" | "reserved" | "release_pending" | "released_unsubmitted" | "exposure_unknown";
export interface Permit2ProductionRecord {
    readonly schemaVersion: typeof PERMIT2_PRODUCTION_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly material: Permit2ProductionMaterial;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly state: Permit2ProductionState;
    readonly terminal: boolean;
    readonly reservationStarted: boolean;
    readonly usageReservationId: string;
    readonly usageReservationDigest: string | null;
    readonly exposureAt: string | null;
    readonly releaseDigest: string | null;
    readonly integrityHash: string;
}
export declare function permit2ProductionId(profile: string, key: string): string;
export declare function productionUsageIdentity(record: Permit2ProductionRecord): {
    account: `0x${string}`;
    chain: "eip155:43114";
    asset: {
        kind: "token";
        identifier: `0x${string}`;
    };
};
export declare function productionUsageKey(operationId: string): `x402-permit2-production.v2:${string}`;
export declare function sealPermit2ProductionRecord(body: Omit<Permit2ProductionRecord, "integrityHash">): Permit2ProductionRecord;
export declare function productionRecordBody(record: Permit2ProductionRecord): Omit<Permit2ProductionRecord, "integrityHash">;
export declare function validatePermit2ProductionRecord(value: unknown): Permit2ProductionRecord;
/** Typed private paths only; canonical data uses the existing owned 0700/0600 atomic fsync store. */
export declare class Permit2ProductionRepository extends SecureStateStore {
    ready(): Promise<void>;
    private path;
    findOperation(id: string): Promise<Permit2ProductionRecord | null>;
    listAllOperations(): Promise<readonly Permit2ProductionRecord[]>;
    listOperations(profileHash: string): Promise<readonly Permit2ProductionRecord[]>;
    /** Caller holds profile + operation locks. Only unsigned preparation/lease states can be written in P2. */
    persistLocked(record: Permit2ProductionRecord, createOnly?: boolean): Promise<void>;
    /** Caller holds profile + operation locks; expiry is checked after the secure read immediately before creation. */
    persistPreparedLocked(record: Permit2ProductionRecord, clock: ClockPort): Promise<void>;
}
export declare function publicPermit2Production(record: Permit2ProductionRecord): {
    operationId: string;
    state: Permit2ProductionState;
    terminal: boolean;
    capability: string;
    chain: "eip155:43114";
    payer: `0x${string}`;
    token: `0x${string}`;
    recipient: `0x${string}`;
    amountAtomic: string;
    deadline: string;
    resource: {
        origin: string;
        urlHash: string;
    };
    blockerCodes: string[];
};
