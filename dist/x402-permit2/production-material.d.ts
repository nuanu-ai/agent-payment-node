import { type Permit2CheckedChallenge } from "./checked-challenge.js";
import { type Permit2OwnerAdmission, type Permit2PrepareEvidence, type Permit2PreparedMaterial } from "./prepare.js";
import type { Permit2ReadCheckpoint } from "./read-port.js";
import type { Permit2WalletBinding } from "./owner-binding.js";
export declare const PERMIT2_PRODUCTION_SCHEMA = "apn.x402-permit2-production.v2";
export interface Permit2ProductionMaterial {
    readonly checked: Permit2CheckedChallenge;
    readonly wallet: Permit2WalletBinding;
    readonly checkpoint: Permit2ReadCheckpoint;
    readonly owner: Permit2OwnerAdmission;
    readonly evidence: Permit2PrepareEvidence;
    readonly signingSecond: number;
    readonly nonce: string;
    /** Canonical decimal encoding of every bigint; reconstruction never revives arbitrary fields. */
    readonly preparedCanonicalJson: string;
    readonly typedDataDigest: string;
    readonly eip2612Digest: string | null;
    readonly materialHash: string;
}
export declare function preparedCanonicalJson(value: Permit2PreparedMaterial): string;
export declare function createPermit2ProductionMaterial(input: Omit<Permit2ProductionMaterial, "preparedCanonicalJson" | "typedDataDigest" | "eip2612Digest" | "materialHash">): Permit2ProductionMaterial;
export declare function reconstructPermit2ProductionMaterial(value: Permit2ProductionMaterial): Permit2PreparedMaterial;
export declare function validatePermit2ProductionMaterial(value: unknown): Permit2ProductionMaterial;
