import type { Hex } from "../model.js";
import { type Permit2ProductionRecord } from "./production-repository.js";
declare const SCHEMA = "apn.x402-permit2-production.signed.v1";
/** Private bearer material. Never include this object in public status or errors. */
export interface Permit2ProductionSigned {
    readonly schemaVersion: typeof SCHEMA;
    readonly operationDigest: string;
    readonly permit2Signature: Hex;
    readonly eip2612Signature: Hex | null;
    readonly paymentSignatureHeader: string;
    readonly headerHash: string;
    readonly signedHash: string;
}
/** Stable across lease/effect state changes; binds the entire checked private request via materialHash. */
export declare function permit2ProductionOperationDigest(record: Permit2ProductionRecord): string;
/** Assembles supplied signatures only. Does not sign, reserve, persist or send. */
export declare function createPermit2ProductionSigned(record: Permit2ProductionRecord, permit2Signature: Hex, eip2612Signature: Hex | null, nowSeconds: number): Promise<Permit2ProductionSigned>;
/** Validation remains usable after expiry for observation. It grants no execution admission or chain-wallet proof. */
export declare function validatePermit2ProductionSigned(value: unknown, record: Permit2ProductionRecord): Promise<Permit2ProductionSigned>;
export declare function publicPermit2ProductionSigned(value: unknown, record: Permit2ProductionRecord): Promise<{
    operationDigest: string;
    headerHash: string;
    signedHash: string;
}>;
export {};
