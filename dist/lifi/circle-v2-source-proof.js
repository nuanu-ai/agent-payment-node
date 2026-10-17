import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { assertFinalizedChain, finalizedQuantity } from "../evm-finalized-proof.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { pastUnstartedDeadline } from "../unstarted-deadline.js";
import { CIRCLE_V2_SOURCE_TTL_MS } from "./circle-v2-source-service.js";
export const CIRCLE_SOURCE_PROOF_SCHEMA = "apn.circle-v2-source-proof.v1";
const PROOF_KEYS = ["blockHash", "blockNumberAtomic", "blockTag", "chainId", "finalizedBlockNumberAtomic", "integrityHash", "nonceAtomic",
    "observedAt", "operationId", "payer", "profileHash", "schemaVersion", "status", "to", "transactionHash"];
const UINT = /^(?:0|[1-9][0-9]*)$/u, WORD = /^0x[0-9a-f]{64}$/u;
/**
 * `non-evm-source-journals/<profileHash>/<operationId>.source-proof.json` beside the journal (never a record name, so the
 * operation index walk skips it). Create-only and bound to the journal's own burn (hash, nonce, payer, target): the
 * journal is never rewritten, and the index re-derives the operation as terminal from it after `rm -r operation-index`.
 */
export class CircleSourceProofStore extends SecureStateStore {
    path(journal) {
        stateIdentifier(journal.profileHash, "Circle source proof profile");
        stateIdentifier(journal.operationId, "Circle source proof operation");
        return `non-evm-source-journals/${journal.profileHash}/${journal.operationId}.source-proof.json`;
    }
    async load(journal) {
        const value = await this.readJson(this.path(journal));
        return value === null ? null : validateProof(value, journal);
    }
    /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
    async create(journal, proof) {
        validateProof(proof, journal);
        try {
            await this.writeJson(this.path(journal), proof, true);
        }
        catch (error) {
            if (!(error instanceof ApnError) || error.message !== "State target is already occupied.")
                throw error;
            const existing = await this.load(journal);
            if (existing === null)
                throw error;
            return existing;
        }
        return proof;
    }
}
/** The payer's claim ends with the signing window, or earlier once the burn's finalized receipt is recorded. */
export async function circleSourceTerminal(root, journal) {
    return pastUnstartedDeadline(Date.parse(journal.createdAt) + CIRCLE_V2_SOURCE_TTL_MS) ||
        typeof journal.transactionHash === "string" && await new CircleSourceProofStore(root).load(journal) !== null;
}
/**
 * `operation status` of a Circle CCTP V2 Base source burn: the saved journal and, when its burn transaction is known,
 * that transaction's receipt at the finalized tag (chain id, receipt, finalized head; no archive read). A receipt in a
 * finalized block is recorded once as the operation's proof; otherwise nothing is written and the status says why.
 */
export async function circleSourceStatus(root, journal, read, now) {
    const view = (proof, waitingFor, proofClass) => ({
        schemaVersion: "apn.circle-v2-source-status.v1", operationId: journal.operationId, phase: journal.phase, outcome: proof?.status ?? null,
        sourceProof: proof, waitingFor, journal, proofClass,
        nextActions: proof === null && journal.transactionHash !== null ? [`apn operation status --operation ${journal.operationId}`] : []
    });
    const hash = journal.transactionHash, store = new CircleSourceProofStore(root);
    if (hash === null)
        return view(null, "no burn transaction was signed; nothing of this operation can land", "durable_public_state");
    const existing = await store.load(journal);
    if (existing !== null)
        return view(existing, null, "durable_public_state");
    if (read === undefined)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This runtime has no finalized-tag reader for the Base receipt.");
    const rpc = read(8453);
    await assertFinalizedChain(rpc, 8453);
    const raw = await rpc.call("eth_getTransactionReceipt", [hash]);
    if (raw === null)
        return view(null, `the burn transaction ${hash} to have a receipt`, "chain_verified_public_read");
    const receipt = receiptOf(raw, journal), head = await rpc.call("eth_getBlockByNumber", ["finalized", false]);
    if (!isPlainRecord(head))
        throw new ApnError("APN_RPC_PROTOCOL", "The finalized block is malformed.");
    const finalized = finalizedQuantity(head.number);
    if (receipt.blockNumber > finalized) {
        return view(null, `the burn receipt in block ${receipt.blockNumber} to be finalized (the finalized block is ${finalized})`, "chain_verified_public_read");
    }
    const fields = { schemaVersion: CIRCLE_SOURCE_PROOF_SCHEMA, operationId: journal.operationId, profileHash: journal.profileHash, chainId: 8453,
        payer: journal.sourceCall.from, to: journal.sourceCall.to, transactionHash: hash, nonceAtomic: journal.nonceAtomic, status: receipt.status,
        blockNumberAtomic: receipt.blockNumber.toString(), blockHash: receipt.blockHash, blockTag: "finalized",
        finalizedBlockNumberAtomic: finalized.toString(), observedAt: new Date(now()).toISOString() };
    return view(await store.create(journal, Object.freeze({ ...fields, integrityHash: hashObject(fields) })), null, "chain_verified_public_read");
}
/** The receipt must be the journal's own burn: same hash, sent by the payer to the pinned messenger, in a block. */
function receiptOf(value, journal) {
    if (!isPlainRecord(value) || typeof value.transactionHash !== "string" || value.transactionHash.toLowerCase() !== journal.transactionHash ||
        typeof value.from !== "string" || value.from.toLowerCase() !== journal.sourceCall.from.toLowerCase() ||
        typeof value.to !== "string" || value.to.toLowerCase() !== journal.sourceCall.to.toLowerCase() ||
        typeof value.blockHash !== "string" || !WORD.test(value.blockHash.toLowerCase()) || (value.status !== "0x1" && value.status !== "0x0")) {
        throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered a receipt that is not this operation's burn.");
    }
    return { blockNumber: finalizedQuantity(value.blockNumber), blockHash: value.blockHash.toLowerCase(), status: value.status === "0x1" ? "success" : "reverted" };
}
function proofCorrupt() {
    throw new ApnError("APN_STATE_CORRUPT", "The source proof of a Circle burn is not the one its journal allows.", { reason: "circle_source_proof_binding" });
}
function validateProof(value, journal) {
    if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(PROOF_KEYS))
        proofCorrupt();
    const proof = value, { integrityHash, ...fields } = proof;
    if (proof.schemaVersion !== CIRCLE_SOURCE_PROOF_SCHEMA || hashObject(fields) !== integrityHash || proof.operationId !== journal.operationId ||
        proof.profileHash !== journal.profileHash || proof.chainId !== 8453 || proof.payer !== journal.sourceCall.from || proof.to !== journal.sourceCall.to ||
        proof.transactionHash !== journal.transactionHash || proof.nonceAtomic !== journal.nonceAtomic || !["success", "reverted"].includes(proof.status) ||
        !UINT.test(proof.blockNumberAtomic) || !UINT.test(proof.finalizedBlockNumberAtomic) ||
        BigInt(proof.blockNumberAtomic) > BigInt(proof.finalizedBlockNumberAtomic) || !WORD.test(proof.blockHash) || proof.blockTag !== "finalized" ||
        typeof proof.observedAt !== "string" || !Number.isFinite(Date.parse(proof.observedAt)) ||
        new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt)
        proofCorrupt();
    return Object.freeze(proof);
}
//# sourceMappingURL=circle-v2-source-proof.js.map