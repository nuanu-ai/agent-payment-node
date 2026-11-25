import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmExact } from "../validation.js";

/**
 * MetaMask's own word on why a server-wallet job ended: the job answer's `failureCode` and `failureDescription`, as the
 * SDK's `getJobStatus` returns them (the SDK's own `JobFailedError` reads the same two fields). `null` when the answer
 * names neither. The code is kept only as a closed token with no opaque part (`isSafeFailureCode`). The description is
 * provider text: it is kept only when it is short plain prose that passes `isSafeFailureDescription`, whose rules keep
 * out URLs, credential words, hosts, IP addresses, `0x` values and opaque runs.
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
const CREDENTIAL = /bearer|authori[sz]|token|secret|passw|api.?key|\bkeys?\b|jwt|cookie|session|credential|private|mnemonic|seed|signature/iu;
/** A host, an IP address or a dotted path (three parts joined by dots), or a `0x` value, whole or shortened. */
const LOCATOR = /[A-Za-z0-9]\.[A-Za-z0-9_]+\.[A-Za-z0-9]|\b0x[0-9a-f]/iu;

/**
 * True for a run of letters and digits in the form of an opaque value (a hex value, a key, an id or a part of one): 5 or
 * more characters with a digit, 8 or more hex letters alone, or 8 or more letters whose case turns from lower to upper
 * three times or more.
 */
function opaque(run: string): boolean {
  return (run.length >= 5 && /[0-9]/u.test(run)) || (run.length >= 8 && /^[A-Fa-f]+$/u.test(run)) ||
    (run.length >= 8 && (run.match(/[a-z][A-Z]/gu) ?? []).length >= 3);
}

/** True for a code APN may show: a token of capital letters, digits and `_` in which no `_`-joined part is opaque. */
export function isSafeFailureCode(value: string): boolean {
  return CODE.test(value) && value.split("_").every(part => !opaque(part));
}

/**
 * True for a description APN may show: the characters above, no credential word, no host, IP address, dotted path or
 * `0x` value, and no opaque run of letters and digits. `Policy evaluator outflow.limit_usd degraded: unavailable` passes.
 */
export function isSafeFailureDescription(value: string): boolean {
  if (!DESCRIPTION.test(value) || CREDENTIAL.test(value) || LOCATOR.test(value)) return false;
  return (value.match(/[A-Za-z0-9]+/gu) ?? []).every(run => !opaque(run));
}

/** An absent, `null` or empty field names nothing, as the SDK's own error reads it (`failureDescription ? … : …`). */
const given = (value: unknown): boolean => value !== undefined && value !== null && value !== "";

/** The job answer's two fields reduced to what may leave the helper; `null` when the answer names neither. */
export function providerFailure(code: unknown, description: unknown): MetaMaskProviderFailure | null {
  if (!given(code) && !given(description)) return null;
  const keptCode = typeof code === "string" && isSafeFailureCode(code) ? code : null;
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
  if (f.code !== null && (typeof f.code !== "string" || !isSafeFailureCode(f.code) || f.codeWithheld)) mmFail(reason);
  if (f.description !== null && (typeof f.description !== "string" || !isSafeFailureDescription(f.description) || f.descriptionWithheld)) mmFail(reason);
  if (f.code === null && !f.codeWithheld && f.description === null && !f.descriptionWithheld) mmFail(reason);
  return f as unknown as MetaMaskProviderFailure;
}
