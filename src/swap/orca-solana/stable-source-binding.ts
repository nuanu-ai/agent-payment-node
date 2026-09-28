import { SOLANA_GENESIS } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";

export const ORCA_STABLE_SOURCE_BINDING_SCHEMA = "apn.orca-stable-rpc-source.v1" as const;
export interface OrcaStableSourceBinding {
  readonly schemaVersion: typeof ORCA_STABLE_SOURCE_BINDING_SCHEMA;
  readonly rpcOriginHash: string;
  readonly genesisHash: typeof SOLANA_GENESIS;
}

export function stableSourceBinding(rpcOriginHash: string): OrcaStableSourceBinding {
  if (!/^[a-f0-9]{64}$/u.test(rpcOriginHash)) invalid();
  return { schemaVersion: ORCA_STABLE_SOURCE_BINDING_SCHEMA, rpcOriginHash, genesisHash: SOLANA_GENESIS };
}

export function validateStableSourceBinding(value: unknown): OrcaStableSourceBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "genesisHash,rpcOriginHash,schemaVersion") invalid();
  const binding = value as OrcaStableSourceBinding;
  if (binding.schemaVersion !== ORCA_STABLE_SOURCE_BINDING_SCHEMA ||
      !/^[a-f0-9]{64}$/u.test(binding.rpcOriginHash) || binding.genesisHash !== SOLANA_GENESIS) invalid();
  return binding;
}

function invalid(): never { throw new ApnError("APN_STATE_CORRUPT", "Stable RPC source binding is invalid."); }
