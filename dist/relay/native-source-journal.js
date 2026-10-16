/** Durable single-attempt journal for the Relay native deposit lane. It never signs; dispatch sends once after its marker. */
import { randomBytes } from "node:crypto";
import { keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
const HASH = /^[a-f0-9]{64}$/u, TX_HASH = /^0x[a-f0-9]{64}$/u;
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay native source execution is blocked.", { reason }); }
function corrupt(reason) { throw new ApnError("APN_STATE_CORRUPT", `Relay native source state is invalid: ${reason}.`); }
/** Provider locator stays in the durable owner journal, never in CLI or MCP output. */
export function publicRelayNativeSourceJournal(journal) {
    const { requestId: _requestId, ...publicFields } = journal;
    return publicFields;
}
function journalBody(j) {
    const { integrityHash: _, ...body } = j;
    return body;
}
function validateJournal(value, op) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        corrupt("journal shape");
    const j = value;
    const keys = ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash", "quoteDigest", "requestId",
        "depositEnvelopeHash", "phase", "marker", "markedAt", "transactionHash", "observedAt", "integrityHash"];
    if (Object.keys(j).sort().join() !== keys.sort().join() || j.schemaVersion !== "apn.relay-native-source-journal.v1" ||
        j.profileHash !== op.profileHash || j.operationId !== op.operationId || j.operationIntegrityHash !== op.integrityHash ||
        j.quoteDigest !== op.quoteDigest || j.requestId !== op.statusLocator?.requestId ||
        j.depositEnvelopeHash !== hashObject(op.nativeQuote.deposit) || !["pending", "signing_started", "sealed", "submitting", "confirmed", "failed", "failed_before_effect", "abandoned_unsent"].includes(j.phase) ||
        j.integrityHash !== hashObject(journalBody(j)))
        corrupt("journal binding");
    if (j.phase === "pending") {
        if (j.marker !== null || j.markedAt !== null || j.transactionHash !== null || j.observedAt !== null)
            corrupt("pending journal");
    }
    else {
        if (typeof j.marker !== "string" || !HASH.test(j.marker) || typeof j.markedAt !== "string" ||
            !Number.isFinite(Date.parse(j.markedAt)))
            corrupt("journal marker");
        if (["signing_started", "failed_before_effect"].includes(j.phase) ? j.transactionHash !== null :
            typeof j.transactionHash !== "string" || !TX_HASH.test(j.transactionHash))
            corrupt("journal hash");
        if (["confirmed", "failed", "failed_before_effect", "abandoned_unsent"].includes(j.phase) ?
            typeof j.observedAt !== "string" || !Number.isFinite(Date.parse(j.observedAt)) : j.observedAt !== null)
            corrupt("journal observation");
    }
    return j;
}
export class RelayNativeSourceJournalRepository extends SecureStateStore {
    path(op) { return `relay-native-source-journals/${op.profileHash}/${op.operationId}.json`; }
    async load(op) {
        const value = await this.readJson(this.path(op));
        return value === null ? null : validateJournal(value, op);
    }
    async hasEffectClaim(op) {
        if (op.sourceChainId !== 8453)
            return false;
        return await this.readJson(`relay-native-signing-claims/${op.operationId}.json`) !== null ||
            await this.readJson(`relay-native-broadcast-claims/${op.operationId}.json`) !== null;
    }
    async claimSigning(op, nonce) {
        if (op.sourceChainId !== 8453)
            return;
        await this.ensureDirectory("relay-native-signing-claims");
        await this.writeJson(`relay-native-signing-claims/${op.operationId}.json`, {
            schemaVersion: "apn.relay-native-signing-claim.v1", operationId: op.operationId,
            operationIntegrityHash: op.integrityHash, sourceChainId: op.sourceChainId,
            owner: op.sourceAccount, quoteDigest: op.quoteDigest, nonce: nonce.toString(),
            depositEnvelopeHash: hashObject(op.nativeQuote.deposit),
        }, true);
    }
    /** Independent create-only fence survives restoration of an older mutable journal. */
    async claimBroadcast(op, raw) {
        if (op.sourceChainId !== 8453)
            return;
        const transactionHash = keccak256(raw);
        await this.ensureDirectory("relay-native-broadcast-claims");
        await this.writeJson(`relay-native-broadcast-claims/${op.operationId}.json`, {
            schemaVersion: "apn.relay-native-broadcast-claim.v1", operationId: op.operationId,
            operationIntegrityHash: op.integrityHash, sourceChainId: op.sourceChainId,
            owner: op.sourceAccount, quoteDigest: op.quoteDigest, transactionHash,
            wireHash: hashObject({ raw }), depositEnvelopeHash: hashObject(op.nativeQuote.deposit),
        }, true);
    }
    async advance(op, expected, phase, hash = null, now = new Date()) {
        await this.initialize();
        return this.withLocks([`relay-native-journal:${op.operationId}`], async () => {
            const old = await this.load(op);
            if ((old?.integrityHash ?? null) !== expected)
                blocked("stale_journal");
            const previous = old?.phase ?? null;
            if (!((previous === null && phase === "pending") || (previous === "pending" && phase === "signing_started") ||
                (previous === "signing_started" && phase === "sealed") || (previous === "sealed" && phase === "submitting") ||
                (previous === "signing_started" && phase === "failed_before_effect") || (previous === "sealed" && phase === "abandoned_unsent") ||
                (previous === "submitting" && (phase === "confirmed" || phase === "failed"))))
                blocked("journal_transition");
            const fields = previous === null ? { schemaVersion: "apn.relay-native-source-journal.v1",
                profileHash: op.profileHash, operationId: op.operationId, operationIntegrityHash: op.integrityHash,
                quoteDigest: op.quoteDigest, requestId: op.statusLocator.requestId,
                depositEnvelopeHash: hashObject(op.nativeQuote.deposit), phase, marker: null, markedAt: null,
                transactionHash: null, observedAt: null } : { ...journalBody(old), phase,
                marker: phase === "signing_started" ? randomBytes(32).toString("hex") : old.marker,
                markedAt: phase === "signing_started" ? now.toISOString() : old.markedAt,
                transactionHash: phase === "sealed" ? hash : old.transactionHash,
                observedAt: ["confirmed", "failed", "failed_before_effect", "abandoned_unsent"].includes(phase) ? now.toISOString() : old.observedAt };
            const next = validateJournal({ ...fields, integrityHash: hashObject(fields) }, op);
            await this.ensureDirectory(`relay-native-source-journals/${op.profileHash}`);
            await this.writeJson(this.path(op), next, previous === null);
            return next;
        });
    }
}
/** Persist the single dispatch marker before the send. Replays only return the marker. */
export async function dispatchRelayNativeDepositOnce(op, journal, store, send, raw, now) {
    if (journal.phase === "submitting")
        return journal;
    if (journal.phase !== "sealed" || keccak256(raw) !== journal.transactionHash)
        blocked("sealed_dispatch_required");
    const marked = await store.advance(op, journal.integrityHash, "submitting", null, now);
    try {
        await store.claimBroadcast(op, raw);
        await send(raw);
    }
    catch { /* An ambiguous or previously claimed send is never repeated. */ }
    return marked;
}
//# sourceMappingURL=native-source-journal.js.map