import { SecureStateStore } from "../secure-state-store.js";
import { type Permit2ProductionRecord } from "./production-repository.js";
/** Since 0.5.110 a hint also keeps the answer body's hash and length; v1 hints (0.5.107–0.5.109) never did. */
export declare const PERMIT2_HTTP_OBSERVATION_SCHEMA = "apn.permit2-production-http-observation.v2";
declare const SCHEMA = "apn.permit2-production-http-observation.v2", SCHEMA_V1 = "apn.permit2-production-http-observation.v1";
declare const CLASSIFICATIONS: readonly ["no_header", "invalid_response", "success_hint", "pending_hint", "failure_hint"];
/** An untrusted locator only. No value in this codec is financial or transport authority. */
interface Permit2HttpLocatorHintV1 {
    readonly schemaVersion: typeof SCHEMA_V1;
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
/** v2 adds the seller body's hash (the x402 result rule, `apn.x402.result-body.v1`) and byte length; never the body. */
interface Permit2HttpLocatorHintV2 extends Omit<Permit2HttpLocatorHintV1, "schemaVersion"> {
    readonly schemaVersion: typeof SCHEMA;
    readonly bodyHash: string;
    readonly bodyByteLength: string;
}
export type Permit2HttpLocatorHint = Permit2HttpLocatorHintV1 | Permit2HttpLocatorHintV2;
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
