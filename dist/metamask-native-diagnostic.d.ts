declare const NATIVE_DIAGNOSTIC_STAGES: readonly ["sdk_resolver", "sdk_read", "sdk_send", "owner_guard", "rpc_balance", "rpc_nonce", "post_handoff"];
declare const NATIVE_DIAGNOSTIC_CODES: readonly ["ok", "deadline", "refused", "timeout", "exit", "signal", "protocol", "start", "internal"];
export interface MetaMaskNativeDiagnostic {
    readonly stage: typeof NATIVE_DIAGNOSTIC_STAGES[number];
    readonly code: typeof NATIVE_DIAGNOSTIC_CODES[number];
    readonly exitCode: number | null;
    readonly signal: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP" | "SIGABRT" | "SIGSEGV" | "SIGPIPE" | null;
    readonly durationMs: number;
    readonly remainingMs: number;
    readonly stderrClass: "none" | "json_error" | "unclassified";
    readonly providerCode: "none" | "policy" | "mfa" | "auth" | "funds" | "rate_limit" | "other";
}
export declare function validateMetaMaskNativeDiagnostic(value: unknown): MetaMaskNativeDiagnostic;
/** Read-only timing bound, never a consent or financial authority. */
export declare function nativeDeadlineRemaining(deadline: string): number;
export declare function nativeContextDeadline(context: {
    readonly consentExpiresAt: string;
    readonly quote: {
        readonly expiresAt: string;
    };
}): string;
export {};
