import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmExact } from "../validation.js";

/**
 * MetaMask's own word on why a server-wallet job ended: the job answer's `failureCode` and `failureDescription`, as the
 * SDK's `getJobStatus` returns them (the SDK's own `JobFailedError` reads the same two fields). `null` when the answer
 * names neither. The code is kept only as a closed token. The description is provider text: it is kept only when it is
 * short plain prose that cannot carry a credential, a URL, an address or an identifier (`isSafeFailureDescription`).
 * A field MetaMask gave in any other form is withheld: its value is `null` and its `*Withheld` flag says it was given.
 * It is the provider's word, never chain evidence.
 */
export interface MetaMaskProviderFailure {
  readonly code: string | null;
  readonly codeWithheld: boolean;
  readonly description: string | null;
  readonly descriptionWithheld: boolean;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
/** Letters, digits, spaces and plain punctuation only: no `/`, `?`, `=`, `&`, `@`, `#`, `%`, `+`, quotes or line breaks. */
const DESCRIPTION = /^[A-Za-z0-9 .,:;_()'-]{1,200}$/u;
/** Words that name a credential or a session: a description that holds one is withheld whatever it says. */
const CREDENTIAL = /bearer|authori[sz]|token|secret|passw|api.?key|jwt|cookie|session|credential|private|mnemonic|seed|signature/iu;

/**
 * True for a description APN may show. Besides the characters and words above, no run of 8 or more letters and digits
 * may hold a digit or be hex letters alone: that is the form of a hex value, an address, a key, a UUID part or any other
 * opaque value. `Policy evaluator outflow.limit_usd degraded: unavailable` passes.
 */
export function isSafeFailureDescription(value: string): boolean {
  if (!DESCRIPTION.test(value) || CREDENTIAL.test(value)) return false;
  return (value.match(/[A-Za-z0-9]{8,}/gu) ?? []).every(run => !/[0-9]/u.test(run) && !/^[A-Fa-f]+$/u.test(run));
}

const given = (value: unknown): boolean => value !== undefined && value !== null;

/** The job answer's two fields reduced to what may leave the helper; `null` when the answer names neither. */
export function providerFailure(code: unknown, description: unknown): MetaMaskProviderFailure | null {
  if (!given(code) && !given(description)) return null;
  const keptCode = typeof code === "string" && CODE.test(code) ? code : null;
  const keptDescription = typeof description === "string" && isSafeFailureDescription(description) ? description : null;
  return { code: keptCode, codeWithheld: given(code) && keptCode === null, description: keptDescription,
    descriptionWithheld: given(description) && keptDescription === null };
}

/**
 * The parent's check of the helper's `failure`: exactly these four fields, a kept code a token, a kept description safe,
 * a withheld field `null`, and at least one field given. Any other form refuses with `reason`.
 */
export function assertProviderFailure(value: unknown, reason: MetaMaskGaslessFailureReason): MetaMaskProviderFailure | null {
  if (value === null) return null;
  const f = mmExact(value, ["code", "codeWithheld", "description", "descriptionWithheld"], reason);
  if (typeof f.codeWithheld !== "boolean" || typeof f.descriptionWithheld !== "boolean") mmFail(reason);
  if (f.code !== null && (typeof f.code !== "string" || !CODE.test(f.code) || f.codeWithheld)) mmFail(reason);
  if (f.description !== null && (typeof f.description !== "string" || !isSafeFailureDescription(f.description) || f.descriptionWithheld)) mmFail(reason);
  if (f.code === null && !f.codeWithheld && f.description === null && !f.descriptionWithheld) mmFail(reason);
  return f as unknown as MetaMaskProviderFailure;
}
