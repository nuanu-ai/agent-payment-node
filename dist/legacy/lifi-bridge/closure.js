import { getAddress } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { BRIDGE_TERMINAL } from "../../lifi/operation-model.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
export const LEGACY_BRIDGE_CLOSURE_SCHEMA = "apn.bridge-legacy-closure.v1";
/** The only closure: at the finalized block the signer's nonce is past every envelope of the journal and none of its own transactions is pending. */
export const LEGACY_BRIDGE_CLOSURE_REASON = "legacy_closed_nonce_consumed";
const CLOSURE_KEYS = ["account", "blockTag", "chainId", "closedAt", "finalizedNonceAtomic", "highestEnvelopeNonceAtomic", "integrityHash",
    "operationId", "ownTransactions", "profileHash", "reason", "recordIntegrityHash", "recordState", "schemaVersion"];
const UINT = /^(?:0|[1-9][0-9]*)$/u, HASH = /^0x[0-9a-fA-F]{64}$/u;
function bindingFailed(reason) {
    throw new ApnError("APN_STATE_CORRUPT", "A frozen bridge journal does not bind its own signing envelopes.", { reason });
}
/**
 * What the frozen journal itself says the closure must prove: its source chain and owner, the highest nonce any of its
 * envelopes froze (every signature and send of the pre-allowlist writer used exactly that envelope nonce), and the
 * transaction hashes it recorded.
 */
export function legacyBridgeClosureFacts(record) {
    const raw = record.raw, chainId = raw.intent.sourceDeployment.chainId;
    let account;
    try {
        account = getAddress(raw.intent.owner.address);
    }
    catch {
        return bindingFailed("legacy_bridge_owner");
    }
    let highest = -1n;
    for (const { envelope } of raw.effects) {
        if (envelope.chainId !== chainId || envelope.from.toLowerCase() !== account.toLowerCase() || !UINT.test(envelope.economics.nonceAtomic)) {
            bindingFailed("legacy_bridge_envelope_binding");
        }
        const nonce = BigInt(envelope.economics.nonceAtomic);
        if (nonce > highest)
            highest = nonce;
    }
    const ownHashes = raw.effects.map(effect => effect.transactionHash).filter((hash) => hash !== null);
    if (highest < 0n || ownHashes.some(hash => !HASH.test(hash)))
        bindingFailed("legacy_bridge_envelope_binding");
    return { chainId, account, highestNonce: highest, ownHashes };
}
/** Terminal by its own state (the outcome list its validator ties `terminal` to), or by a closure bound to this exact journal. */
export async function legacyBridgeTerminal(root, record) {
    return BRIDGE_TERMINAL.includes(record.state) || await new LegacyBridgeClosureStore(root).load(record) !== null;
}
export function sealLegacyBridgeClosure(fields) {
    return Object.freeze({ ...fields, integrityHash: hashObject(fields) });
}
/**
 * `bridge-operations/<profileHash>/<operationId>.legacy-closure.json` beside the journal (never a record name, so the
 * operation index walk skips it). Create-only: the journal is never rewritten, and the operation index, a rebuildable
 * cache, re-derives the journal as terminal from this file after `rm -r operation-index`.
 */
export class LegacyBridgeClosureStore extends SecureStateStore {
    path(record) {
        stateIdentifier(record.profileHash, "bridge legacy closure profile");
        stateIdentifier(record.operationId, "bridge legacy closure operation");
        return `bridge-operations/${record.profileHash}/${record.operationId}.legacy-closure.json`;
    }
    async load(record) {
        const value = await this.readJson(this.path(record));
        return value === null ? null : validateClosure(value, record);
    }
    /** Publishes the closure once; a concurrent closer's file wins and is returned after the same validation. */
    async create(record, closure) {
        validateClosure(closure, record);
        try {
            await this.writeJson(this.path(record), closure, true);
        }
        catch (error) {
            if (!(error instanceof ApnError) || error.message !== "State target is already occupied.")
                throw error;
            const existing = await this.load(record);
            if (existing === null)
                throw error;
            return existing;
        }
        return closure;
    }
}
function closureCorrupt(reason) {
    throw new ApnError("APN_STATE_CORRUPT", "The closure of a frozen bridge journal is not the one this journal allows.", { reason });
}
function validateClosure(value, record) {
    if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(CLOSURE_KEYS))
        closureCorrupt("closure_shape");
    const closure = value, { integrityHash, ...fields } = closure, facts = legacyBridgeClosureFacts(record);
    const own = Array.isArray(closure.ownTransactions) ? closure.ownTransactions : [];
    if (closure.schemaVersion !== LEGACY_BRIDGE_CLOSURE_SCHEMA || hashObject(fields) !== integrityHash || closure.operationId !== record.operationId ||
        closure.profileHash !== record.profileHash || closure.recordIntegrityHash !== record.raw.integrityHash || closure.recordState !== record.state ||
        closure.reason !== LEGACY_BRIDGE_CLOSURE_REASON || closure.chainId !== facts.chainId || closure.account !== facts.account ||
        closure.blockTag !== "finalized" || closure.highestEnvelopeNonceAtomic !== facts.highestNonce.toString() ||
        typeof closure.finalizedNonceAtomic !== "string" || !UINT.test(closure.finalizedNonceAtomic) || BigInt(closure.finalizedNonceAtomic) <= facts.highestNonce ||
        canonicalJson(own.map(item => item?.transactionHash)) !== canonicalJson(facts.ownHashes) ||
        own.some(item => !isPlainRecord(item) || Object.keys(item).length !== 2 || !["not_found", "included"].includes(item.seen)) ||
        typeof closure.closedAt !== "string" || !Number.isFinite(Date.parse(closure.closedAt)) ||
        new Date(Date.parse(closure.closedAt)).toISOString() !== closure.closedAt)
        closureCorrupt("closure_binding");
    return Object.freeze(closure);
}
//# sourceMappingURL=closure.js.map