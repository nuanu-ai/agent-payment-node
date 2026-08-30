/** The provider has no seller-specific response schema, so only intrinsically non-secret JSON is accepted. */
export function isSafeNormalizedProviderJson(value: unknown): value is null | boolean {
  return value === null || typeof value === "boolean";
}
