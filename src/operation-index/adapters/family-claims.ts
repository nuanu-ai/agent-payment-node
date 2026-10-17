import { sha256 } from "../../canonical.js";
import { SOLANA_GENESIS } from "../../chain-policy.js";
import { conflictDomainKey, evmConflictDomain, railConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { TRON_GENESIS } from "../../tron/constants.js";
import { canonicalProfile } from "../../wallet-policy.js";
import { field, salvageEvm, salvageRail, salvageRecord, type SalvagedRecord } from "../adapter.js";
import { profileClaim, type OperationClaim } from "../types.js";

export { pastUnstartedDeadline, UNSTARTED_DEADLINE_MARGIN_MS } from "../../unstarted-deadline.js";

/** A CAIP-2 chain (`eip155:<id>`, `solana:<genesis>`, `tron:<genesis>`) and its signing account as a conflict domain. */
export function chainDomain(chain: string, account: string): MoneyConflictDomain {
  const [namespace, reference, ...rest] = chain.split(":");
  if (rest.length === 0 && namespace === "eip155" && reference !== undefined) return evmConflictDomain(reference, account);
  if (rest.length === 0 && namespace === "solana" && reference === SOLANA_GENESIS) return railConflictDomain("solana", account);
  if (rest.length === 0 && namespace === "tron" && reference === TRON_GENESIS) return railConflictDomain("tron", account);
  throw new Error("Unknown swap chain.");
}
export const domainClaim = (domain: MoneyConflictDomain): OperationClaim => ({ key: conflictDomainKey(domain) });
export const evmClaim = (chainId: number | string, account: string): OperationClaim => domainClaim(evmConflictDomain(chainId, account));

/** Salvage of a CAIP-2 chain and account, canonical values only. */
export function salvageChain(chain: unknown, account: unknown): OperationClaim {
  if (typeof chain !== "string") throw new Error("Salvaged chain is not canonical.");
  if (chain.startsWith("eip155:")) return salvageEvm(chain.slice("eip155:".length), account);
  const rail = chain === `solana:${SOLANA_GENESIS}` ? "solana" : chain === `tron:${TRON_GENESIS}` ? "tron" : null;
  if (rail === null) throw new Error("Salvaged chain is not canonical.");
  return salvageRail(rail, account);
}

/** The profile claim under the state store's own profile hash, for records that name the profile itself. */
export const namedProfileClaim = (profile: string): OperationClaim => profileClaim(namedProfileHash(profile));
export const namedProfileHash = (profile: string): string => sha256(`profile\0${profile}`);

/** Salvage for records that name their profile rather than a profile hash: the name counts only when canonical. */
export function salvageNamedRecord(raw: unknown, extract: (raw: unknown) => readonly OperationClaim[], ...profilePath: readonly string[]): SalvagedRecord {
  const name = field(raw, ...profilePath);
  let profileHashes: readonly string[] = [];
  try { if (typeof name === "string" && canonicalProfile(name) === name) profileHashes = [namedProfileHash(name)]; } catch { profileHashes = []; }
  return { ...salvageRecord(raw, extract, []), profileHashes };
}
