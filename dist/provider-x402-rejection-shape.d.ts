export declare const PROVIDER_X402_KNOWN_ENVELOPE_KEYS: readonly ["status", "statusText", "data", "paymentMade", "amountPaid"];
type KnownEnvelopeKey = typeof PROVIDER_X402_KNOWN_ENVELOPE_KEYS[number];
type JsonValueType = "null" | "boolean" | "number" | "string" | "array" | "object";
type RootType = "invalid_json" | JsonValueType;
export interface ProviderX402RejectionShapeField {
    readonly name: KnownEnvelopeKey;
    readonly value_type: JsonValueType;
    readonly length: string;
}
export interface ProviderX402RejectionShape {
    readonly schema_version: "apn.provider-x402.rejection-shape.v1";
    readonly root_type: RootType;
    readonly known_fields: readonly ProviderX402RejectionShapeField[];
    readonly sampled_key_count: string;
    readonly sampled_unknown_key_count: string;
    readonly sampled_protected_key_count: string;
    readonly sampled_conflicting_alias_count: string;
    readonly truncated: boolean;
    readonly shape_sha256: string;
}
export declare function providerX402RejectionShape(bytes: Buffer): ProviderX402RejectionShape;
export declare function validateProviderX402RejectionShape(value: unknown): ProviderX402RejectionShape;
export declare function isConflictingProviderX402OuterKey(key: string): boolean;
export {};
