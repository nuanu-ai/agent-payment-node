/** In-process local native identity only; never human approval, key or signing authority. */
export interface Permit2LocalCapability {
    readonly kind: "permit2-local-native-capability";
}
/** Privately minted only by an actual local native inside its active exposed scope. */
export interface Permit2NativeSigningExecution {
    readonly kind: "permit2-native-signing-execution";
}
/** In-process actual signing origin only; never a paid HTTP grant. */
export interface Permit2NativeSigningOrigin {
    readonly kind: "permit2-native-signing-origin";
}
/** Actual privately claimed paid signing origin only; never caller registration. */
export interface Permit2NativeRequestExecution {
    readonly kind: "permit2-native-request-execution";
}
/** First durable request marker plus genuine paid UI provenance; not a reusable HTTP grant. */
export interface Permit2NativeRequestGrant {
    readonly kind: "permit2-native-request-grant";
}
/** Minted only inside actual native held dispatch scope for its concrete HTTPS port. */
export interface Permit2NativeDispatchExecution {
    readonly kind: "permit2-native-dispatch-execution";
}
