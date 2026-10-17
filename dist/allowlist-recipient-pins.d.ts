import type { AssetPolicyAdmission, AssetPolicyChainFamily, AssetRailAdmission } from "./asset-policy-registry.js";
/**
 * Owner recipient pins (decision OD-1). The owner may pin 1 to 16 exact recipients on a `direct`, `x402` or `bridge`
 * admission row, or on one `mechanismOptions.bridge` alternative. A rail that evaluates such an admission calls
 * `assertRecipientAdmitted` wherever it evaluates the policy: prepare, approval, reservation and first send.
 *
 * Absent pin means this policy does not restrict recipients. That is the documented meaning, not a default: the
 * recipient stays a required per-operation input, shown on the foreground consent screen and bound into the operation.
 * Gasless keeps its own single `gaslessRecipient` pin; swap has no recipient.
 */
export declare const RECIPIENT_PIN_RAILS: readonly ["direct", "x402", "bridge"];
export type RecipientPinRail = (typeof RECIPIENT_PIN_RAILS)[number];
export declare const MAX_RECIPIENT_PINS = 16;
/** Registry row field: admitted rail to its pinned recipients. */
export type AssetRecipientPins = Readonly<Partial<Record<RecipientPinRail, readonly string[]>>>;
export type RecipientPinMechanism = Readonly<{
    provider: string;
    reference: string;
}>;
export declare function isRecipientPinRail(rail: string): rail is RecipientPinRail;
/** The chain family of a CAIP-2 network identity used in policies, or null. */
export declare function policyChainFamily(chain: unknown): AssetPolicyChainFamily | null;
/**
 * The canonical spelling of one address and its family, or null. EVM accepts any hex case and returns the checksum
 * spelling; TRON accepts base58 or `41` hex and returns base58; Solana returns the base58 key. Zero addresses are null.
 */
export declare function canonicalRecipient(value: unknown): {
    readonly family: AssetPolicyChainFamily;
    readonly address: string;
} | null;
/**
 * One owner-written pin list exactly as written, or null when invalid: 1 to 16 unique canonical non-zero addresses.
 * `family` binds every entry to the row's chain family (direct, x402); a bridge list passes null, because its recipient
 * lives on the destination chain, which may be another family.
 */
export declare function recipientPinList(value: unknown, family: AssetPolicyChainFamily | null): readonly string[] | null;
/** Registry row check: keys are admitted pin rails, every list is canonical, and a bridge row pin excludes bridge alternatives. */
export declare function rowRecipientPinsValid(value: unknown, rails: AssetRailAdmission, family: AssetPolicyChainFamily, bridgeAlternatives: boolean): boolean;
/**
 * The pin that governs this admission, or undefined when the policy does not restrict recipients. With bridge
 * alternatives the selected alternative's own pin governs, so `mechanism` must name an admitted alternative.
 */
export declare function admittedRecipientPins(admission: AssetPolicyAdmission, mechanism?: RecipientPinMechanism): readonly string[] | undefined;
/** True when the admission's pin (if any) lists this recipient. A recipient of any spelling is compared canonically. */
export declare function recipientAdmitted(input: {
    readonly admission: AssetPolicyAdmission;
    readonly mechanism?: RecipientPinMechanism;
    readonly recipient: string;
}): boolean;
/**
 * Refuse an operation whose recipient is outside the owner's pin for this admission. Pass the admission that
 * `evaluateAssetPolicy` just returned for this operation, the exact mechanism the rail executes (required when the row
 * has bridge alternatives) and the operation's own recorded recipient. Throws `APN_ALLOWLIST_REFUSED` with reason
 * `allowlist_recipient_not_admitted` (or `allowlist_recipient_mechanism_required`); returns when admitted or unpinned.
 */
export declare function assertRecipientAdmitted(input: {
    readonly admission: AssetPolicyAdmission;
    readonly mechanism?: RecipientPinMechanism;
    readonly recipient: string;
}): void;
