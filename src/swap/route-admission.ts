import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { AssetPolicyRow } from "../asset-policy-registry.js";
import { canonicalProgramIdentity, SWAP_MECHANISM_PIN_SCHEMA, SWAP_PROTOCOL_NETWORKS, validateSwapMechanismPin,
  type SwapMechanismPin, type SwapProtocolFamily } from "./pin.js";
import { validateSwapProtocolRegistry, type SwapProtocolRecord, type SwapProtocolRegistry } from "./protocol-registry.js";

export const SWAP_ROUTE_SCHEMA = "apn.swap-route.v1" as const;

/**
 * What the owner admits for a swap: the protocol, its router or program and the contracts or pools it touches. It has
 * no APN-internal version, constructor or schema field, so an APN release or a program-byte re-pin never changes it.
 */
export interface SwapRouteAdmission {
  readonly schemaVersion: typeof SWAP_ROUTE_SCHEMA;
  readonly protocolFamily: SwapProtocolFamily;
  readonly chain: string;
  readonly routerProgramIdentity: string;
  readonly auxiliaryContractProgramIdentities: readonly string[];
}
/** A legacy full mechanism pin is still accepted; it admits by its route identity, never by its version fields. */
export type SwapAdmissionMechanism = SwapMechanismPin | SwapRouteAdmission;
export const MAX_SWAP_ADMISSION_OPTIONS = 16;

export function validateSwapAdmissionMechanism(value: unknown): SwapAdmissionMechanism {
  if (isPlainRecord(value) && value.schemaVersion === SWAP_MECHANISM_PIN_SCHEMA) return validateSwapMechanismPin(value);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "protocolFamily", "chain", "routerProgramIdentity",
    "auxiliaryContractProgramIdentities"]) || value.schemaVersion !== SWAP_ROUTE_SCHEMA ||
      typeof value.protocolFamily !== "string" || !Object.hasOwn(SWAP_PROTOCOL_NETWORKS, value.protocolFamily) ||
      typeof value.routerProgramIdentity !== "string" || !Array.isArray(value.auxiliaryContractProgramIdentities) ||
      value.auxiliaryContractProgramIdentities.length > 16 ||
      value.auxiliaryContractProgramIdentities.some((item: unknown) => typeof item !== "string")) invalid("Swap route admission is malformed.");
  const network = SWAP_PROTOCOL_NETWORKS[value.protocolFamily as SwapProtocolFamily];
  if (value.chain !== network.chain) invalid("Swap route admission does not match its protocol family's exact chain.");
  const programs = [value.routerProgramIdentity as string, ...(value.auxiliaryContractProgramIdentities as string[])];
  if (programs.some((identity) => canonicalProgramIdentity(network.family, identity) !== identity) || new Set(programs).size !== programs.length) {
    invalid("Swap route router and contract identities must be canonical and distinct.");
  }
  return value as unknown as SwapRouteAdmission;
}

/** The route identity of a lane pin: what an owner copies from an inventory into a policy file. */
export function swapRouteOf(pin: SwapMechanismPin): SwapRouteAdmission {
  const value = validateSwapMechanismPin(pin);
  return { schemaVersion: SWAP_ROUTE_SCHEMA, protocolFamily: value.protocolFamily, chain: value.chain,
    routerProgramIdentity: value.routerProgramIdentity, auxiliaryContractProgramIdentities: [...value.auxiliaryContractProgramIdentities] };
}

/** Order-insensitive digest of the route identity; equal for every generation of the same protocol, router and pools. */
export function swapRouteDigest(value: unknown): string {
  const mechanism = validateSwapAdmissionMechanism(value);
  return domainHash(SWAP_ROUTE_SCHEMA, canonicalJson({ protocolFamily: mechanism.protocolFamily, chain: mechanism.chain,
    routerProgramIdentity: mechanism.routerProgramIdentity,
    auxiliaryContractProgramIdentities: [...mechanism.auxiliaryContractProgramIdentities].sort() }));
}

/** Every swap mechanism one asset row admits: the single legacy pin or the owner's list of alternatives. */
export function swapAdmissionMechanisms(asset: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">): readonly SwapAdmissionMechanism[] {
  if (!asset.rails.swap) return [];
  const single = asset.mechanismPins?.swap;
  return single === undefined ? asset.mechanismOptions?.swap ?? [] : [single];
}

export function assetAdmitsSwapMechanism(asset: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">, lanePin: SwapMechanismPin): boolean {
  const route = swapRouteDigest(lanePin);
  return swapAdmissionMechanisms(asset).some((mechanism) => swapRouteDigest(mechanism) === route);
}

/**
 * Selects the one lane record of an installed protocol registry whose route both assets admit. A version bump of the
 * lane keeps its route, so it stays admitted; a different route (another router or pool) never does.
 */
export function admittedSwapProtocol(registryValue: SwapProtocolRegistry, chain: string,
  source: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">,
  destination: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">, laneMechanismDigest?: string): SwapProtocolRecord {
  // A registry holding several lanes of one route (Orca's preview and guarded stable pins) is disambiguated by the lane
  // itself naming its exact mechanism; the owner's admission still decides only by route.
  const lanes = validateSwapProtocolRegistry(registryValue).records.filter(({ pin, mechanismDigest }) => pin.chain === chain &&
    (laneMechanismDigest === undefined || mechanismDigest === laneMechanismDigest));
  const bySource = lanes.filter(({ pin }) => assetAdmitsSwapMechanism(source, pin));
  if (bySource.length === 0) blocked("Source asset lacks the exact swap mechanism admission.");
  const both = bySource.filter(({ pin }) => assetAdmitsSwapMechanism(destination, pin));
  if (both.length === 0) blocked("Destination asset lacks the same exact swap mechanism admission.");
  if (both.length !== 1) blocked("More than one installed swap mechanism matches the owner admission; select one exact mechanism.");
  return both[0]!;
}

function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
