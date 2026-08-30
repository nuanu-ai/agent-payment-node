/** The provider has no seller-specific response schema, so only intrinsically non-secret JSON is accepted. */
export function isSafeNormalizedProviderJson(value) {
    return value === null || typeof value === "boolean";
}
//# sourceMappingURL=normalized-provider-json.js.map