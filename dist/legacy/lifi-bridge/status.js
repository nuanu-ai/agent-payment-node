import { ApnError } from "../../errors.js";
import { checkNonceClosure } from "../../evm-finalized-proof.js";
import { BRIDGE_TERMINAL } from "../../lifi/operation-model.js";
import { publicLegacyBridgeOperation } from "../../lifi/receipt.js";
import { LEGACY_BRIDGE_CLOSURE_REASON, LEGACY_BRIDGE_CLOSURE_SCHEMA, legacyBridgeClosureFacts, LegacyBridgeClosureStore, sealLegacyBridgeClosure } from "./closure.js";
/** A frozen (pre-allowlist) journal whose state is not one of the family's outcomes: only its closure can end it. */
export function legacyBridgeOpen(record) {
    return !BRIDGE_TERMINAL.includes(record.state);
}
/**
 * R4 exit of a frozen bridge journal that the live code never resumes (no signing, no money, no consent): the family
 * status reads, at the finalized tag of its source chain, the owner's nonce and the journal's own transaction hashes.
 * Nonce past every envelope nonce and nothing pending writes the closure once beside the journal; otherwise it stays
 * open and says what it waits for. A journal already in an outcome state answers its stored view as before.
 */
export async function legacyBridgeStatus(root, record, read, now) {
    const stored = publicLegacyBridgeOperation(record);
    if (!legacyBridgeOpen(record))
        return stored;
    const view = (closure, waitingFor, proofClass) => ({ ...stored,
        legacy_closure: { terminal: closure !== null, terminal_reason: closure === null ? null : LEGACY_BRIDGE_CLOSURE_REASON, closure,
            waiting_for: waitingFor, read_only: true },
        proof_class: proofClass, next_actions: closure === null ? [`apn operation status --operation ${record.operationId}`] : [] });
    const store = new LegacyBridgeClosureStore(root), existing = await store.load(record);
    if (existing !== null)
        return view(existing, null, "durable_public_state");
    const facts = legacyBridgeClosureFacts(record);
    if (read === undefined)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This runtime has no finalized-tag reader for the closure.");
    const check = await checkNonceClosure(facts, read(record.raw.intent.sourceDeployment.chainId));
    if (!check.closed)
        return view(null, check.waitingFor, "chain_verified_public_read");
    const closure = await store.create(record, sealLegacyBridgeClosure({ schemaVersion: LEGACY_BRIDGE_CLOSURE_SCHEMA, operationId: record.operationId,
        profileHash: record.profileHash, recordIntegrityHash: record.raw.integrityHash, recordState: record.state, reason: LEGACY_BRIDGE_CLOSURE_REASON,
        chainId: facts.chainId, account: facts.account, blockTag: "finalized", highestEnvelopeNonceAtomic: facts.highestNonce.toString(),
        finalizedNonceAtomic: check.finalizedNonce.toString(), ownTransactions: check.ownTransactions, closedAt: new Date(now()).toISOString() }));
    return view(closure, null, "chain_verified_public_read");
}
//# sourceMappingURL=status.js.map