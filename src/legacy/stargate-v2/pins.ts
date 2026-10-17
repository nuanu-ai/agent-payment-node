import { getAddress } from "viem";
import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";

/**
 * Frozen copies of the pins the Stargate readers of 60b247d5^ (the last tree that read native schema v1 and token schemas
 * v1..v4) checked. These records were written only by unreleased builds of 2026-09-20; they stay on owners' disks, so their
 * reader stays, read-only. Never edit these values to follow the live lanes: they describe what those builds wrote.
 */
export const LEGACY_NATIVE_LANE = Object.freeze({
  sourceChain: 1, destinationChain: 130, sourceEid: 30101, destinationEid: 30320,
  sourcePool: getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931"),
  destinationPool: getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7"),
});
export const LEGACY_TOKEN_LANE = Object.freeze({
  sourceChain: 10, destinationChain: 137, sourceEid: 30111, destinationEid: 30109,
  sourceToken: getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
  destinationToken: getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
  sourcePool: getAddress("0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0"),
  destinationPool: getAddress("0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4"),
  sourceExecutor: getAddress("0x2D2ea0697bdbede3F01553D2Ae4B8d0c486B666e"),
  maxBridgeGas: 5_000_000n,
});
export const LEGACY_TOKEN_MECHANISM = Object.freeze({ provider: "stargate-v2",
  reference: `eip155:10:${LEGACY_TOKEN_LANE.sourcePool}/eip155:137:${LEGACY_TOKEN_LANE.destinationPool}` });
export const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;

/** The block tags `apn.stargate-v2-finality.v1` pinned per chain on 2026-09-20 (only the chains of these two lanes). */
const PINNED_TAG: Readonly<Record<number, "safe" | "finalized">> = Object.freeze({ 1: "safe", 10: "safe", 130: "safe", 137: "finalized" });
const pinnedPolicy = (source: number, destination: number) => ({ version: "apn.stargate-v2-finality.v1",
  source: { chainId: source, blockTag: PINNED_TAG[source] }, destination: { chainId: destination, blockTag: PINNED_TAG[destination] } });
const legacySafePolicy = (source: number, destination: number) => ({ version: "apn.stargate-v2-finality.legacy-safe-v1",
  source: { chainId: source, blockTag: "safe" }, destination: { chainId: destination, blockTag: "safe" } });
function samePolicy(actual: unknown, expected: unknown): boolean {
  try { return canonicalJson(actual) === canonicalJson(expected); } catch { return false; }
}

export function fail(reason: string): never {
  throw new ApnError("APN_STATE_CORRUPT", `Unreleased Stargate record failed its frozen reader: ${reason}.`, { reason });
}
/** A v1 record either carries no policy (the reader derived the historical all-safe one) or exactly that derived policy. */
export function assertLegacyV1Policy(record: Readonly<Record<string, unknown>>,
  source: number, destination: number): void {
  if (record.finalityPolicy === undefined && record.finalityPolicyProvenance === undefined) return;
  if (!samePolicy(record.finalityPolicy, legacySafePolicy(source, destination))) fail("finality_policy");
  if (record.finalityPolicyProvenance !== "derived_legacy_v1") fail("finality_policy_provenance");
}
/** Every later unreleased schema froze the pinned policy at prepare. */
export function assertPinnedPolicy(record: Readonly<Record<string, unknown>>,
  source: number, destination: number): void {
  if (!samePolicy(record.finalityPolicy, pinnedPolicy(source, destination))) fail("finality_policy");
  if (record.finalityPolicyProvenance !== "pinned_v2") fail("finality_policy_provenance");
}
