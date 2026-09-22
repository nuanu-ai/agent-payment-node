export declare const TOKEN_PRIMARY_POOL_ENV = "APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS";
export declare const TOKEN_PRIMARY_POOL_MAX = 3;
export interface TokenPrimaryCandidate {
    readonly url: URL;
    readonly id: string;
    readonly familyHash: string;
}
export type TokenPrimaryFailureReason = "cooldown" | "deadline" | "rate_limited" | "http_5xx" | "authentication" | "malformed" | "wrong_chain" | "capability";
export interface TokenPrimaryAttemptTelemetry {
    readonly providerId: string;
    readonly outcome: "selected" | "recovery_bound" | "failed" | "cooldown_skipped";
    readonly reason: TokenPrimaryFailureReason | null;
}
export interface TokenPrimaryPoolTelemetry {
    readonly schemaVersion: "apn.uniswap-token-primary-pool-telemetry.v1";
    readonly configuredCandidates: number;
    readonly selectedProviderId: string | null;
    readonly attempts: readonly TokenPrimaryAttemptTelemetry[];
}
export declare function tokenPrimaryCandidates(environment: Readonly<Record<string, string | undefined>>): readonly TokenPrimaryCandidate[];
