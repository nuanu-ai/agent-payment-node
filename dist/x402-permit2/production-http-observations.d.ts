import { SecureStateStore } from "../secure-state-store.js";
import { type Permit2ProductionRecord } from "./production-repository.js";
declare const SCHEMA = "apn.permit2-production-http-observation.v1";
declare const CLASSIFICATIONS: readonly ["no_header", "invalid_response", "success_hint", "pending_hint", "failure_hint"];
/** An untrusted locator only. No value in this codec is financial or transport authority. */
export interface Permit2HttpLocatorHint {
    readonly schemaVersion: typeof SCHEMA;
    readonly operationId: string;
    readonly materialHash: string;
    readonly requestHash: string;
    readonly challengeHash: string;
    readonly signedHash: string;
    readonly httpStatus: number;
    readonly paymentResponseHeaderHash: string | null;
    readonly classification: typeof CLASSIFICATIONS[number];
    readonly locator: string | null;
}
export declare function normalizePermit2Locator(value: unknown): string;
export declare function validatePermit2HttpLocatorHint(value: unknown, record: Permit2ProductionRecord): Permit2HttpLocatorHint;
export declare function permit2HttpLocatorHint(record: Permit2ProductionRecord, observation: unknown): Permit2HttpLocatorHint;
/** First observation is immutable under the established profile/operation/EVM group. */
export declare class Permit2HttpObservationStore extends SecureStateStore {
    #private;
    constructor(root: string);
    read(id: string, record: Permit2ProductionRecord): Promise<Permit2HttpLocatorHint | null>;
    write(id: string, observation: unknown): Promise<Permit2HttpLocatorHint>;
}
export {};
