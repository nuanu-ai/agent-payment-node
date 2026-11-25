import { type MetaMaskGaslessFailureReason } from "../reasons.js";
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
/** True for a code APN may show: a token of capital letters, digits and `_` in which no `_`-joined part is opaque. */
export declare function isSafeFailureCode(value: string): boolean;
/**
 * True for a description APN may show: the characters above, no credential word, no host, IP address, dotted path or
 * `0x` value, and no opaque run of letters and digits. `Policy evaluator outflow.limit_usd degraded: unavailable` passes.
 */
export declare function isSafeFailureDescription(value: string): boolean;
/** The job answer's two fields reduced to what may leave the helper; `null` when the answer names neither. */
export declare function providerFailure(code: unknown, description: unknown): MetaMaskProviderFailure | null;
/**
 * The parent's check of the helper's `failure`: exactly these four fields, a kept code a token, a kept description safe,
 * a withheld field `null`, and at least one field given. Any other form refuses with `reason`.
 */
export declare function assertProviderFailure(value: unknown, reason: MetaMaskGaslessFailureReason): MetaMaskProviderFailure | null;
