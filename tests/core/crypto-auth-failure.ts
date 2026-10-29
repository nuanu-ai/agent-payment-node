/**
 * An AES-256-GCM authentication failure as the linked OpenSSL reports it (QA 0.5.78 SOURCE-TEST-CRYPTO-ERROR-PORTABILITY-078-001).
 * Node's bundled OpenSSL 3 throws a plain Error without a code, "Unsupported state or unable to authenticate data";
 * OpenSSL 4 (Homebrew node@24 24.22, linked to openssl@4 4.1.0) throws ERR_OSSL_BAD_DECRYPT,
 * "error:1C800064:Provider routines::bad decrypt". Only these two exact forms are an authentication failure.
 */
const FORMS: readonly (readonly [code: string | null, message: string])[] = [
  [null, "Unsupported state or unable to authenticate data"],
  ["ERR_OSSL_BAD_DECRYPT", "error:1C800064:Provider routines::bad decrypt"],
];

export function gcmAuthenticationFailure(name: unknown, code: unknown, message: unknown): boolean {
  return name === "Error" && FORMS.some(([known, text]) => known === (code ?? null) && text === message);
}

/** An Error the decipher threw, judged by its own name, code and message. */
export const isGcmAuthenticationError = (error: unknown): boolean =>
  error instanceof Error && gcmAuthenticationFailure(error.name, (error as { code?: unknown }).code, error.message);

/** A recorded outcome with either authentication-failure form written as one, so two runtimes compare equal. */
export function gcmCanonical<T extends { readonly ok: boolean }>(outcome: T): T | (Omit<T, "code" | "message"> & { readonly gcm: "authentication_failure" }) {
  const failed = outcome as T & { name?: unknown; code?: unknown; message?: unknown };
  if (outcome.ok || !gcmAuthenticationFailure(failed.name, failed.code, failed.message)) return outcome;
  const { code: _code, message: _message, ...rest } = failed;
  return { ...rest, gcm: "authentication_failure" } as Omit<T, "code" | "message"> & { readonly gcm: "authentication_failure" };
}
