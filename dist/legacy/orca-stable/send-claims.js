import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { solanaSignature } from "../../solana/rpc.js";
const SEND_CLAIM_VERSION = "apn.orca-stable-send-claim.v1";
/**
 * Frozen reader. A released stable sender wrote this claim before transport, so it permanently consumed the first send
 * right, including after a process crash: its presence means a send may have happened, its absence that none did.
 */
class OrcaStableSendClaimStore extends SecureStateStore {
    initialized;
    async exists(operation) {
        return (await this.load(operation)) !== null;
    }
    async load(operation) {
        await this.ready();
        const directory = `orca-stable-send-claims/${operation.ownerProfileHash}`;
        const name = `${operation.operationId}.json`;
        if (!(await this.readDirectory(directory)).some(entry => entry.name === name))
            return null;
        // readJson maps both an absent file and canonical JSON null to null. Directory occupancy is the
        // existence authority; an occupied but unreadable/invalid claim must never reopen a send or release.
        const raw = await this.readJson(this.path(operation));
        if (!isPlainRecord(raw) || !exactKeys(raw, ["schemaVersion", "operationId", "markerHash",
            "bindingHash", "accountIdentityHash", "signature", "rawPayloadHash", "claimedAt", "claimHash"]))
            corrupt("Stable send claim is malformed.");
        const claim = raw;
        const { claimHash, ...body } = claim;
        if (claim.schemaVersion !== SEND_CLAIM_VERSION || claim.operationId !== operation.operationId ||
            claim.markerHash !== operation.submissionMarker?.markerHash ||
            ![claim.bindingHash, claim.accountIdentityHash, claim.rawPayloadHash, claimHash]
                .every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) ||
            typeof claim.claimedAt !== "string" || !Number.isFinite(Date.parse(claim.claimedAt)) ||
            new Date(claim.claimedAt).toISOString() !== claim.claimedAt ||
            claim.claimedAt < operation.submissionMarker.markedAt ||
            claimHash !== domainHash(SEND_CLAIM_VERSION, canonicalJson(body)))
            corrupt("Stable send claim binding changed.");
        try {
            solanaSignature(claim.signature);
        }
        catch {
            corrupt("Stable send claim signature is malformed.");
        }
        return claim;
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "stable send profile");
        stateIdentifier(operation.operationId, "stable send operation");
        return `orca-stable-send-claims/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-send-claims"); })();
        await this.initialized;
    }
}
/** Recovery cannot release principal after a send right was consumed, even if custody is later unreadable. */
export async function hasOrcaStableSendClaim(root, operation) {
    return await new OrcaStableSendClaimStore(root).exists(operation);
}
export async function loadOrcaStableSendClaim(root, operation) {
    return await new OrcaStableSendClaimStore(root).load(operation);
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=send-claims.js.map