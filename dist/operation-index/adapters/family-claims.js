import { sha256 } from "../../canonical.js";
import { SOLANA_GENESIS } from "../../chain-policy.js";
import { conflictDomainKey, evmConflictDomain, railConflictDomain } from "../../operation-conflict-domain.js";
import { TRON_GENESIS } from "../../tron/constants.js";
import { canonicalProfile } from "../../wallet-policy.js";
import { field, salvageEvm, salvageRail, salvageRecord } from "../adapter.js";
import { profileClaim } from "../types.js";
/**
 * An effect its family never started cannot start once this long has passed after the family's own signing deadline
 * (every family below refuses to sign past that deadline). It is the bound of the admission lease, so a process that
 * stalls between its deadline check and its effect marker is covered as long as an orphaned admission would be.
 */
export const UNSTARTED_DEADLINE_MARGIN_MS = 10 * 60_000;
/** True once `deadline` (ISO time or epoch milliseconds) plus the margin has passed; an unreadable deadline never passes. */
export function pastUnstartedDeadline(deadline, now = Date.now()) {
    const at = typeof deadline === "number" ? deadline : Date.parse(deadline);
    return Number.isFinite(at) && now >= at + UNSTARTED_DEADLINE_MARGIN_MS;
}
/** A CAIP-2 chain (`eip155:<id>`, `solana:<genesis>`, `tron:<genesis>`) and its signing account as a conflict domain. */
export function chainDomain(chain, account) {
    const [namespace, reference, ...rest] = chain.split(":");
    if (rest.length === 0 && namespace === "eip155" && reference !== undefined)
        return evmConflictDomain(reference, account);
    if (rest.length === 0 && namespace === "solana" && reference === SOLANA_GENESIS)
        return railConflictDomain("solana", account);
    if (rest.length === 0 && namespace === "tron" && reference === TRON_GENESIS)
        return railConflictDomain("tron", account);
    throw new Error("Unknown swap chain.");
}
export const domainClaim = (domain) => ({ key: conflictDomainKey(domain) });
export const evmClaim = (chainId, account) => domainClaim(evmConflictDomain(chainId, account));
/** Salvage of a CAIP-2 chain and account, canonical values only. */
export function salvageChain(chain, account) {
    if (typeof chain !== "string")
        throw new Error("Salvaged chain is not canonical.");
    if (chain.startsWith("eip155:"))
        return salvageEvm(chain.slice("eip155:".length), account);
    const rail = chain === `solana:${SOLANA_GENESIS}` ? "solana" : chain === `tron:${TRON_GENESIS}` ? "tron" : null;
    if (rail === null)
        throw new Error("Salvaged chain is not canonical.");
    return salvageRail(rail, account);
}
/** The profile claim under the state store's own profile hash, for records that name the profile itself. */
export const namedProfileClaim = (profile) => profileClaim(namedProfileHash(profile));
export const namedProfileHash = (profile) => sha256(`profile\0${profile}`);
/** Salvage for records that name their profile rather than a profile hash: the name counts only when canonical. */
export function salvageNamedRecord(raw, extract, ...profilePath) {
    const name = field(raw, ...profilePath);
    let profileHashes = [];
    try {
        if (typeof name === "string" && canonicalProfile(name) === name)
            profileHashes = [namedProfileHash(name)];
    }
    catch {
        profileHashes = [];
    }
    return { ...salvageRecord(raw, extract, []), profileHashes };
}
//# sourceMappingURL=family-claims.js.map