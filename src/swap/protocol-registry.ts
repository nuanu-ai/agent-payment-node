import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { swapMechanismDigest, validateSwapMechanismPin, type SwapMechanismPin } from "./pin.js";

export const SWAP_PROTOCOL_REGISTRY_SCHEMA = "apn.swap-protocol-registry.v1" as const;
const VERSION = /^(?=[a-z0-9._-]{1,64}$)(?=.*[0-9])[a-z0-9][a-z0-9._-]*$/u;

export interface SwapProtocolRecord {
  readonly pin: SwapMechanismPin;
  readonly mechanismDigest: string;
}
export interface SwapProtocolRegistry {
  readonly schemaVersion: typeof SWAP_PROTOCOL_REGISTRY_SCHEMA;
  readonly registryVersion: string;
  readonly records: readonly SwapProtocolRecord[];
  readonly registryDigest: string;
}

/** The shipped registry is intentionally empty until owners supply official immutable pins. */
export const EMPTY_SWAP_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({ registryVersion: "unconfigured.1", pins: [] });

export function compileSwapProtocolRegistry(input: { readonly registryVersion: string; readonly pins: readonly unknown[] }): SwapProtocolRegistry {
  if (!isPlainRecord(input) || !exactKeys(input, ["registryVersion", "pins"]) || typeof input.registryVersion !== "string" ||
      !VERSION.test(input.registryVersion) || !Array.isArray(input.pins) || input.pins.length > 16) invalid("Swap protocol registry input is invalid.");
  const records = input.pins.map((raw) => {
    const pin = validateSwapMechanismPin(raw);
    return { pin, mechanismDigest: swapMechanismDigest(pin) };
  }).sort((a, b) => a.mechanismDigest.localeCompare(b.mechanismDigest));
  const identities = new Set<string>(), constructors = new Set<string>();
  for (const { pin } of records) {
    const identity = `${pin.chain}\0${pin.protocolFamily}\0${pin.routerProgramIdentity}\0${pin.transactionSchemaVersion}`;
    const constructor = `${pin.constructorKind}\0${pin.constructorIdentity}\0${pin.constructorVersion}`;
    if (identities.has(identity) || constructors.has(constructor)) {
      invalid("Swap protocol registry contains a duplicate or conflicting identity.");
    }
    identities.add(identity); constructors.add(constructor);
  }
  const body = { schemaVersion: SWAP_PROTOCOL_REGISTRY_SCHEMA, registryVersion: input.registryVersion, records } as const;
  return { ...body, registryDigest: domainHash(SWAP_PROTOCOL_REGISTRY_SCHEMA, canonicalJson(body)) };
}

export function validateSwapProtocolRegistry(value: unknown): SwapProtocolRegistry {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "registryVersion", "records", "registryDigest"]) ||
      value.schemaVersion !== SWAP_PROTOCOL_REGISTRY_SCHEMA || typeof value.registryVersion !== "string" ||
      !VERSION.test(value.registryVersion) || !Array.isArray(value.records) || value.records.length > 16 ||
      typeof value.registryDigest !== "string" || !/^[a-f0-9]{64}$/u.test(value.registryDigest)) corrupt();
  let compiled: SwapProtocolRegistry;
  try {
    compiled = compileSwapProtocolRegistry({ registryVersion: value.registryVersion, pins: value.records.map((record) => {
      if (!isPlainRecord(record) || !exactKeys(record, ["pin", "mechanismDigest"]) ||
          typeof record.mechanismDigest !== "string" || swapMechanismDigest(record.pin) !== record.mechanismDigest) corrupt();
      return record.pin;
    }) });
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    return corrupt();
  }
  if (canonicalJson(compiled) !== canonicalJson(value)) corrupt();
  return value as unknown as SwapProtocolRegistry;
}

export function requireSwapProtocol(registryValue: unknown, mechanismDigest: string): SwapProtocolRecord {
  const registry = validateSwapProtocolRegistry(registryValue);
  const record = registry.records.find((row) => row.mechanismDigest === mechanismDigest);
  if (record === undefined) throw new ApnError("APN_OPERATION_BLOCKED", "The exact swap mechanism is not admitted.");
  return record;
}

/** A legacy family/chain lookup may select only when the identity is unambiguous. */
export function requireUnambiguousSwapProtocol(registryValue: unknown, chain: string, protocolFamily: string): SwapProtocolRecord {
  const matches = validateSwapProtocolRegistry(registryValue).records.filter(({ pin }) =>
    pin.chain === chain && pin.protocolFamily === protocolFamily);
  if (matches.length !== 1) throw new ApnError("APN_OPERATION_BLOCKED", "An exact swap mechanism must be selected.",
    { reason: matches.length === 0 ? "swap_protocol_absent" : "swap_protocol_ambiguous" });
  return matches[0]!;
}

function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Swap protocol registry integrity validation failed."); }
