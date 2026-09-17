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
  }).sort((a, b) => a.pin.protocolFamily.localeCompare(b.pin.protocolFamily));
  const chains = new Set<string>(), protocols = new Set<string>(), routers = new Set<string>(), constructors = new Set<string>();
  for (const { pin } of records) {
    if (chains.has(pin.chain) || protocols.has(pin.protocolFamily) || routers.has(pin.routerProgramIdentity) ||
        constructors.has(`${pin.constructorKind}\0${pin.constructorIdentity}`)) {
      invalid("Swap protocol registry contains a duplicate or conflicting identity.");
    }
    chains.add(pin.chain); protocols.add(pin.protocolFamily); routers.add(pin.routerProgramIdentity);
    constructors.add(`${pin.constructorKind}\0${pin.constructorIdentity}`);
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

function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Swap protocol registry integrity validation failed."); }
