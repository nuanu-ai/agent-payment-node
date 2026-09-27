import type { ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import type { ChainAccount } from "../../direct-rail-ports.js";
export interface OrcaStableOwnerAdmission {
    readonly profile: string;
    readonly owner: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest: string;
    readonly mechanismDigest: string;
    readonly pool: string;
    readonly program: string;
    readonly sourceMint: string;
    readonly destinationMint: string;
    readonly amountInAtomic: string;
    readonly minimumOutputAtomic: string;
    /** This only proves local policy admission; it is not a quote, simulation, or signable operation. */
    readonly signable: false;
    readonly executable: false;
}
export interface OrcaStableAdmissionPorts {
    readonly activePolicy: (profile: string) => Promise<ActiveAssetPolicy | null>;
    readonly localAccount: (profile: string) => Promise<ChainAccount | null>;
    readonly dailyUsage: (owner: string, mint: string, now: Date) => Promise<string>;
}
/** Run before RPC. The revision is supplied by the caller's intended policy, then verified against active sealed state. */
export declare function admitOrcaStableOwner(ports: OrcaStableAdmissionPorts, request: {
    readonly profile: string;
    readonly owner: string;
    readonly policyRevision: number;
    readonly amountInAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly now: Date;
}, expectedMechanismDigest?: string): Promise<OrcaStableOwnerAdmission>;
/** Bind a later observed quote to the prechecked admission; caller must recheck active revision before any operation. */
export declare function assertOrcaStableQuoteAdmission(admission: OrcaStableOwnerAdmission, quote: {
    readonly chain: string;
    readonly pool: string;
    readonly program: string;
    readonly sourceMint: string;
    readonly destinationMint: string;
    readonly amountInAtomic: string;
    readonly minimumOutputAtomic: string;
}): void;
/** Recheck immediately after a snapshot; a changed activation or depleted daily cap refuses. */
export declare function recheckOrcaStableOwner(ports: OrcaStableAdmissionPorts, admission: OrcaStableOwnerAdmission, now: Date): Promise<void>;
