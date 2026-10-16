import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { tronAddress } from "./tron/codec.js";
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
export const RECIPIENT_PIN_RAILS = ["direct", "x402", "bridge"] as const;
export type RecipientPinRail = (typeof RECIPIENT_PIN_RAILS)[number];
export const MAX_RECIPIENT_PINS = 16;
/** Registry row field: admitted rail to its pinned recipients. */
export type AssetRecipientPins = Readonly<Partial<Record<RecipientPinRail, readonly string[]>>>;
export type RecipientPinMechanism = Readonly<{ provider: string; reference: string }>;

const ZERO: Readonly<Record<AssetPolicyChainFamily, string>> = {
  evm: "0x0000000000000000000000000000000000000000",
  solana: "11111111111111111111111111111111",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
};

export function isRecipientPinRail(rail: string): rail is RecipientPinRail {
  return (RECIPIENT_PIN_RAILS as readonly string[]).includes(rail);
}

/** The chain family of a CAIP-2 network identity used in policies, or null. */
export function policyChainFamily(chain: unknown): AssetPolicyChainFamily | null {
  if (typeof chain !== "string") return null;
  return chain.startsWith("eip155:") ? "evm" : chain.startsWith("solana:") ? "solana" : chain.startsWith("tron:") ? "tron" : null;
}

/**
 * The canonical spelling of one address and its family, or null. EVM accepts any hex case and returns the checksum
 * spelling; TRON accepts base58 or `41` hex and returns base58; Solana returns the base58 key. Zero addresses are null.
 */
export function canonicalRecipient(value: unknown): { readonly family: AssetPolicyChainFamily; readonly address: string } | null {
  if (typeof value !== "string") return null;
  // A TRON address decodes to 21 bytes and a Solana key to 32, so at most one of the base58 readings succeeds.
  const families: readonly AssetPolicyChainFamily[] = /^0x[0-9a-fA-F]{40}$/u.test(value) ? ["evm"] : ["tron", "solana"];
  for (const family of families) {
    try {
      const address = family === "evm" ? getAddress(value) : family === "tron" ? tronAddress(value) : solanaAddress(value);
      return address === ZERO[family] ? null : { family, address };
    } catch { /* not this family */ }
  }
  return null;
}

/**
 * One owner-written pin list exactly as written, or null when invalid: 1 to 16 unique canonical non-zero addresses.
 * `family` binds every entry to the row's chain family (direct, x402); a bridge list passes null, because its recipient
 * lives on the destination chain, which may be another family.
 */
export function recipientPinList(value: unknown, family: AssetPolicyChainFamily | null): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RECIPIENT_PINS || new Set(value).size !== value.length) return null;
  for (const entry of value) {
    const canonical = canonicalRecipient(entry);
    if (canonical === null || canonical.address !== entry || (family !== null && canonical.family !== family)) return null;
  }
  return value as readonly string[];
}

/** Registry row check: keys are admitted pin rails, every list is canonical, and a bridge row pin excludes bridge alternatives. */
export function rowRecipientPinsValid(value: unknown, rails: AssetRailAdmission, family: AssetPolicyChainFamily, bridgeAlternatives: boolean): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((rail) => isRecipientPinRail(rail) && rails[rail] &&
    !(rail === "bridge" && bridgeAlternatives) && recipientPinList(value[rail], rail === "bridge" ? null : family) !== null);
}

/**
 * The pin that governs this admission, or undefined when the policy does not restrict recipients. With bridge
 * alternatives the selected alternative's own pin governs, so `mechanism` must name an admitted alternative.
 */
export function admittedRecipientPins(admission: AssetPolicyAdmission, mechanism?: RecipientPinMechanism): readonly string[] | undefined {
  if (!isRecipientPinRail(admission.rail)) return undefined;
  const options = admission.rail === "bridge" ? admission.asset.mechanismOptions?.bridge : undefined;
  if (options === undefined) return admission.asset.recipients?.[admission.rail];
  const selected = mechanism === undefined ? undefined
    : options.find((option) => option.provider === mechanism.provider && option.reference === mechanism.reference);
  if (selected === undefined) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", "The bridge recipient pin applies per admitted mechanism; name the exact admitted mechanism.",
      { reason: "allowlist_recipient_mechanism_required", rail: admission.rail });
  }
  return selected.recipients;
}

/** True when the admission's pin (if any) lists this recipient. A recipient of any spelling is compared canonically. */
export function recipientAdmitted(input: {
  readonly admission: AssetPolicyAdmission; readonly mechanism?: RecipientPinMechanism; readonly recipient: string;
}): boolean {
  const pins = admittedRecipientPins(input.admission, input.mechanism);
  if (pins === undefined) return true;
  const canonical = canonicalRecipient(input.recipient);
  return canonical !== null && pins.includes(canonical.address);
}

/**
 * Refuse an operation whose recipient is outside the owner's pin for this admission. Pass the admission that
 * `evaluateAssetPolicy` just returned for this operation, the exact mechanism the rail executes (required when the row
 * has bridge alternatives) and the operation's own recorded recipient. Throws `APN_ALLOWLIST_REFUSED` with reason
 * `allowlist_recipient_not_admitted` (or `allowlist_recipient_mechanism_required`); returns when admitted or unpinned.
 */
export function assertRecipientAdmitted(input: {
  readonly admission: AssetPolicyAdmission; readonly mechanism?: RecipientPinMechanism; readonly recipient: string;
}): void {
  if (recipientAdmitted(input)) return;
  throw new ApnError("APN_ALLOWLIST_REFUSED", "The active owner allowlist policy pins the recipients of this admission; this recipient is not one of them.",
    { reason: "allowlist_recipient_not_admitted", rail: input.admission.rail, chain: input.admission.chain, recipient: String(input.recipient) });
}
