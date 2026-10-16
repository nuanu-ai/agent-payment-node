/** Pure funding-v2 metadata only. No custody, reservation, network, CLI or execution authority. */
import { getAddress, type Address } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { sealedStoredRecord, type StoredRecordFailureReason } from "../stored-record-binding.js";
import { CIRCLE_SOURCE_TOKEN, circleFundingMechanism, circleRoute, isCircleDestinationChain, type CircleDestinationChain } from "./catalog.js";
import type { CircleAccountPreflight } from "./preflight.js";

export const CIRCLE_FUNDING_OPERATION_V2 = "apn.circle-v2-evm-operation.v2" as const;
const UINT256 = (1n << 256n) - 1n;
const ZERO = `0x${"0".repeat(40)}`;
const FIELDS = ["recipient", "amountAtomic", "maxFeeAtomic", "minMintAtomic"] as const;
export interface CircleFundingParameters {
  readonly recipient: Address; readonly amountAtomic: string; readonly maxFeeAtomic: string; readonly minMintAtomic: string;
}
export interface CircleFundingBindingV2 extends CircleFundingParameters {
  readonly schemaVersion: "apn.circle-funding-binding.v2";
  readonly sourceProfile: string; readonly sourceChain: 42161; readonly sourceDomain: 3;
  readonly sourceOwner: Address; readonly sourceToken: Address; readonly decimals: 6;
  readonly destinationChain: CircleDestinationChain; readonly destinationDomain: 16 | 11 | 15;
  readonly destinationToken: Address; readonly destinationProfile: string; readonly gasPayer: Address;
  readonly mechanism: Readonly<{ provider: "circle-cctp-v2"; reference: string }>;
  readonly bindingHash: string;
}
export interface CircleFundingFeeV2 {
  readonly schemaVersion: "apn.circle-fast-fee.v2"; readonly bindingHash: string;
  readonly minimumFeeBps: string; readonly quotedFeeAtomic: string;
  readonly fetchedAtMs: number; readonly expiresAtMs: number; readonly responseHash: string; readonly integrityHash: string;
}
/** A sealed intent is not an executable operation or authorization grant. Phase B owns those boundaries. */
export interface CircleFundingIntentV2 {
  readonly schemaVersion: "apn.circle-v2-evm-operation-intent.v2";
  readonly operationSchemaVersion: typeof CIRCLE_FUNDING_OPERATION_V2;
  readonly binding: CircleFundingBindingV2; readonly feeQuote: CircleFundingFeeV2;
  readonly deploymentDigest: string; readonly preparedAt: string; readonly expiresAt: string; readonly integrityHash: string;
}
function refuse(reason: string): never { throw new ApnError("APN_INVALID_INPUT", "Circle funding metadata is invalid.", { reason }); }
function uint(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) refuse("funding_quantity");
  const n = BigInt(value); if (n > UINT256 || positive && n === 0n) refuse("funding_quantity"); return n;
}
function address(value: unknown): Address {
  try { if (typeof value !== "string" || getAddress(value) !== value || value === ZERO) refuse("funding_address"); return value as Address; }
  catch { return refuse("funding_address"); }
}
function hash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) refuse("funding_hash"); return value; }
function time(value: number): void { if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - 900_000) refuse("funding_time"); }
function parameters(value: unknown): CircleFundingParameters {
  if (!isPlainRecord(value) || !exactKeys(value, FIELDS)) refuse("funding_parameter_shape");
  const recipient = address(value.recipient), amount = uint(value.amountAtomic, true), max = uint(value.maxFeeAtomic, true), min = uint(value.minMintAtomic, true);
  if (max >= amount || min > amount - max) refuse("funding_net_floor");
  return Object.freeze({ recipient, amountAtomic: amount.toString(), maxFeeAtomic: max.toString(), minMintAtomic: min.toString() });
}
/** All absent means the unchanged legacy input. A partial or unknown field set cannot select v2. */
export function deriveCircleFundingParameters(value: unknown): CircleFundingParameters | null {
  if (!isPlainRecord(value)) refuse("funding_parameter_shape");
  if (Object.keys(value).length === 0) return null;
  return parameters(value);
}
/** Who signs: the source profile and its custody wallet, and the destination gas profile and its custody wallet. */
export interface CircleFundingIdentity { readonly sourceProfile: string; readonly sourceOwner: Address; readonly destinationProfile: string; readonly gasPayer: Address; }
const BINDING_KEYS = ["schemaVersion", ...FIELDS, "sourceProfile", "sourceChain", "sourceDomain", "sourceOwner", "sourceToken", "decimals",
  "destinationChain", "destinationDomain", "destinationToken", "destinationProfile", "gasPayer", "mechanism", "bindingHash"] as const;
function profileName(value: unknown): string { if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) refuse("funding_profile"); return value; }
/** Protocol fields come from the route table; identity and economics are the caller's explicit, already-resolved inputs. */
export function circleFundingBinding(chain: CircleDestinationChain, identity: CircleFundingIdentity, value: unknown): CircleFundingBindingV2 {
  if (!isCircleDestinationChain(chain)) refuse("funding_destination");
  const route = circleRoute(chain), p = parameters(value);
  const body = { schemaVersion: "apn.circle-funding-binding.v2" as const, ...p,
    sourceProfile: profileName(identity.sourceProfile), sourceChain: 42161 as const, sourceDomain: 3 as const,
    sourceOwner: address(identity.sourceOwner), sourceToken: CIRCLE_SOURCE_TOKEN, decimals: 6 as const,
    destinationChain: route.chainId, destinationDomain: route.domain, destinationToken: route.token,
    destinationProfile: profileName(identity.destinationProfile), gasPayer: address(identity.gasPayer), mechanism: circleFundingMechanism(route.chainId) };
  return Object.freeze({ ...body, bindingHash: hashObject(body) });
}
/** The STORED binding: exact keys, its own seal, canonical parameters and identity spellings, and protocol fields equal
 * to the route table row it names (OWNR 5.2). Identity is never compared with a constant here; the operation validator
 * binds `sourceProfile/sourceOwner/destinationProfile/gasPayer` to the operation's own profiles and custody records. */
export function validateCircleFundingBinding(value: unknown): CircleFundingBindingV2 {
  const fail = (reason: StoredRecordFailureReason): never => refuse(reason === "stored_record_shape" ? "funding_binding_shape" : "funding_binding_changed");
  const b = sealedStoredRecord<CircleFundingBindingV2>(value, { keys: BINDING_KEYS, sealField: "bindingHash", seal: hashObject }, fail);
  parameters(Object.fromEntries(FIELDS.map(k => [k, b[k]]))); profileName(b.sourceProfile); profileName(b.destinationProfile); address(b.sourceOwner); address(b.gasPayer);
  if (!isCircleDestinationChain(b.destinationChain)) refuse("funding_binding_changed");
  const route = circleRoute(b.destinationChain), mechanism = circleFundingMechanism(route.chainId);
  if (b.schemaVersion !== "apn.circle-funding-binding.v2" || b.sourceChain !== 42161 || b.sourceDomain !== 3 || b.sourceToken !== CIRCLE_SOURCE_TOKEN || b.decimals !== 6 ||
    b.destinationDomain !== route.domain || b.destinationToken !== route.token || !isPlainRecord(b.mechanism) || !exactKeys(b.mechanism, ["provider", "reference"]) ||
    b.mechanism.provider !== mechanism.provider || b.mechanism.reference !== mechanism.reference) refuse("funding_binding_changed");
  return b;
}
export function quoteCircleFundingFee(bindingValue: unknown, response: unknown, fetchedAtMs: number, nowMs: number): CircleFundingFeeV2 {
  const binding = validateCircleFundingBinding(bindingValue); time(fetchedAtMs); time(nowMs);
  if (fetchedAtMs > nowMs || nowMs - fetchedAtMs >= 30_000 || !Array.isArray(response) || response.length > 4) refuse("funding_fee_shape_age");
  if (response.some(x => !isPlainRecord(x))) refuse("funding_fee_shape_age");
  const rows = response.filter(x => x.finalityThreshold === 1000);
  if (rows.length !== 1) refuse("funding_fast_fee_unavailable");
  const rate: unknown = rows[0]!.minimumFee;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || !/^\d+(?:\.\d{1,6})?$/u.test(String(rate))) refuse("funding_fee_rate");
  const [whole, fraction = ""] = String(rate).split("."), denominator = 10n ** BigInt(fraction.length) * 10_000n;
  const numerator = BigInt(`${whole}${fraction}`), fee = (BigInt(binding.amountAtomic) * numerator + denominator - 1n) / denominator;
  if (fee > BigInt(binding.maxFeeAtomic) || BigInt(binding.amountAtomic) - fee < BigInt(binding.minMintAtomic)) refuse("funding_fee_cap_or_net_floor");
  const body = { schemaVersion: "apn.circle-fast-fee.v2" as const, bindingHash: binding.bindingHash, minimumFeeBps: String(rate), quotedFeeAtomic: fee.toString(),
    fetchedAtMs, expiresAtMs: fetchedAtMs + 30_000, responseHash: hashObject(response) };
  return Object.freeze({ ...body, integrityHash: hashObject(body) });
}
export function assertCircleFundingFee(bindingValue: unknown, value: unknown, nowMs: number): CircleFundingFeeV2 {
  const binding = validateCircleFundingBinding(bindingValue); time(nowMs);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "bindingHash", "minimumFeeBps", "quotedFeeAtomic", "fetchedAtMs", "expiresAtMs", "responseHash", "integrityHash"])) refuse("funding_fee_shape");
  const { integrityHash, ...body } = value;
  if (hashObject(body) !== integrityHash || body.schemaVersion !== "apn.circle-fast-fee.v2" || body.bindingHash !== binding.bindingHash ||
    typeof body.fetchedAtMs !== "number" || typeof body.expiresAtMs !== "number") refuse("funding_fee_binding");
  time(body.fetchedAtMs); time(body.expiresAtMs); hash(body.responseHash);
  if (body.expiresAtMs !== body.fetchedAtMs + 30_000 || nowMs < body.fetchedAtMs || nowMs >= body.expiresAtMs ||
    typeof body.minimumFeeBps !== "string" || !/^\d+(?:\.\d{1,6})?$/u.test(body.minimumFeeBps) || !Number.isFinite(Number(body.minimumFeeBps))) refuse("funding_fee_age_rate");
  const [whole, fraction = ""] = body.minimumFeeBps.split("."), denominator = 10n ** BigInt(fraction.length) * 10_000n;
  const fee = (BigInt(binding.amountAtomic) * BigInt(`${whole}${fraction}`) + denominator - 1n) / denominator;
  if (uint(body.quotedFeeAtomic) !== fee || fee > BigInt(binding.maxFeeAtomic) || BigInt(binding.amountAtomic) - fee < BigInt(binding.minMintAtomic)) refuse("funding_fee_cap_or_net_floor");
  return Object.freeze({ ...body, integrityHash } as unknown as CircleFundingFeeV2);
}
export function sealCircleFundingIntent(binding: unknown, feeQuote: unknown, deploymentDigest: string, preparedAtMs: number): CircleFundingIntentV2 {
  time(preparedAtMs); const b = validateCircleFundingBinding(binding), fee = assertCircleFundingFee(b, feeQuote, preparedAtMs);
  const body = { schemaVersion: "apn.circle-v2-evm-operation-intent.v2" as const, operationSchemaVersion: CIRCLE_FUNDING_OPERATION_V2,
    binding: b, feeQuote: fee, deploymentDigest: hash(deploymentDigest), preparedAt: new Date(preparedAtMs).toISOString(), expiresAt: new Date(preparedAtMs + 15 * 60_000).toISOString() };
  return Object.freeze({ ...body, integrityHash: hashObject(body) });
}
export function validateCircleFundingIntent(value: unknown): CircleFundingIntentV2 {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationSchemaVersion", "binding", "feeQuote", "deploymentDigest", "preparedAt", "expiresAt", "integrityHash"]) ||
    typeof value.preparedAt !== "string" || typeof value.expiresAt !== "string") refuse("funding_intent_shape");
  const expected = sealCircleFundingIntent(value.binding, value.feeQuote, String(value.deploymentDigest), Date.parse(value.preparedAt));
  if (hashObject(value) !== hashObject(expected)) refuse("funding_intent_changed"); return expected;
}
/** Evaluate fresh inputs using the normal owner registry. This returns metadata, never a reservation or grant. */
export function admitCircleFundingAssets(bindingValue: unknown, input: {
  readonly source: CircleAccountPreflight; readonly destination: CircleAccountPreflight;
  readonly sourceRegistry: unknown; readonly destinationRegistry: unknown;
  readonly sourceTokenUsageAtomic: string; readonly sourceNativeUsageAtomic: string; readonly destinationNativeUsageAtomic: string;
  readonly nowMs: number;
}): void {
  const b = validateCircleFundingBinding(bindingValue), route = circleRoute(b.destinationChain); time(input.nowMs);
  const s = input.source, d = input.destination;
  if (s.chainId !== b.sourceChain || s.address !== b.sourceOwner || uint(s.usdcBalanceAtomic) < BigInt(b.amountAtomic) ||
    uint(s.nativeBalanceAtomic) < 75_000_000_000_000n || uint(s.allowanceAtomic) !== 0n || uint(s.latestNonceAtomic) !== uint(s.pendingNonceAtomic) ||
    d.chainId !== b.destinationChain || d.address !== b.gasPayer || uint(d.nativeBalanceAtomic) < BigInt(route.destinationNativeCap) || uint(d.latestNonceAtomic) !== uint(d.pendingNonceAtomic)) refuse("funding_accounts");
  const at = new Date(input.nowMs).toISOString();
  const admit = (registry: unknown, chain: number, asset: { kind: "native"; identifier: null } | { kind: "token"; identifier: string }, amountAtomic: string, usage: string) => {
    uint(usage); const result = evaluateAssetPolicy(registry, { chain: `eip155:${chain}`, asset, rail: "bridge", mechanism: b.mechanism,
      amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at });
    if (!bridgeMechanismAdmitted(result, b.mechanism) || result.asset.decimals !== (asset.kind === "token" ? 6 : 18)) refuse("funding_policy_mechanism_or_decimals");
  };
  admit(input.sourceRegistry, 42161, { kind: "token", identifier: b.sourceToken }, b.amountAtomic, input.sourceTokenUsageAtomic);
  let nativeUsage = uint(input.sourceNativeUsageAtomic);
  for (const amount of ["30000000000000", "30000000000000", "15000000000000"]) {
    admit(input.sourceRegistry, 42161, { kind: "native", identifier: null }, amount, nativeUsage.toString()); nativeUsage += BigInt(amount);
  }
  admit(input.destinationRegistry, b.destinationChain, { kind: "native", identifier: null }, route.destinationNativeCap, input.destinationNativeUsageAtomic);
}
