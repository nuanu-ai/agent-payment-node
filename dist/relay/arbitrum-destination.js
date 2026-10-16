/** Ethereum USDC delivery of a saved Arbitrum Relay operation whose deposit the source journal records as final at
 * Arbitrum safe. One keyless Relay status GET supplies the candidate (a discovery hint, never proof); the read-only
 * credit proof accepts only one canonical safe USDC Transfer to the operation's own recipient. An accepted credit takes
 * the shared create-only payout claim (one payout accepts one operation) and an operation-keyed record; once recorded
 * the outcome is terminal and later observations return it without network reads. No signer or broadcaster. */
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { assertStoredFieldsEqual, sealedStoredRecord } from "../stored-record-binding.js";
import { validateRelayArbitrumUsdcEthereumUsdcQuote } from "./arbitrum-usdc-ethereum-quote.js";
import { RelayDestinationClaimRepository } from "./destination-claim.js";
import { proveRelayEthereumUsdcCredit } from "./ethereum-usdc-credit-proof.js";
const SCHEMA = "apn.relay-arbitrum-destination-credit.v1";
const KEYS = ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash", "quoteDigest", "requestId",
    "sourceTransactionHash", "providerStatus", "proof", "recordedAt", "integrityHash"];
const PROOF_KEYS = ["quoteDigest", "orderId", "destinationTransactionHash", "destinationBlockNumber", "destinationBlockHash",
    "safeBlockNumber", "safeBlockHash", "token", "recipient", "minimumOutputAtomic", "creditedAtomic", "transferLogIndex", "proofClass"];
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Relay Arbitrum destination credit record is invalid."); }
class CreditRecords extends SecureStateStore {
    path(op) { return `relay-arbitrum-destination-credits/${op.profileHash}/${op.operationId}.json`; }
    async load(op) {
        await this.initialize();
        const value = await this.readJson(this.path(op));
        if (value === null)
            return null;
        const record = sealedStoredRecord(value, { keys: KEYS, sealField: "integrityHash", seal: hashObject }, corrupt);
        assertStoredFieldsEqual(record, { schemaVersion: SCHEMA, profileHash: op.profileHash, operationId: op.operationId,
            operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest, requestId: op.statusLocator?.requestId,
            providerStatus: "success" }, corrupt);
        const proof = record.proof;
        if (proof === null || typeof proof !== "object" || Object.keys(proof).sort().join() !== [...PROOF_KEYS].sort().join() ||
            proof.quoteDigest !== op.quoteDigest || proof.orderId !== op.arbitrumDraft?.orderId || proof.recipient !== op.recipient.toLowerCase() ||
            proof.proofClass !== "canonical_safe_erc20_transfer_log" || typeof proof.creditedAtomic !== "string" ||
            !/^(0|[1-9][0-9]*)$/u.test(proof.creditedAtomic) || BigInt(proof.creditedAtomic) < BigInt(op.minOutputAtomic))
            corrupt();
        return record;
    }
    async record(op, sourceHash, proof, at) {
        const body = { schemaVersion: SCHEMA, profileHash: op.profileHash, operationId: op.operationId, operationIntegrityHash: op.integrityHash,
            quoteDigest: op.quoteDigest, requestId: op.statusLocator.requestId, sourceTransactionHash: sourceHash.toLowerCase(),
            providerStatus: "success", proof, recordedAt: at.toISOString() };
        const record = { ...body, integrityHash: hashObject(body) };
        await this.initialize();
        return this.withLocks([`relay-arbitrum-destination:${op.operationId}`], async () => {
            const saved = await this.load(op);
            if (saved !== null)
                return saved;
            await this.ensureDirectory(`relay-arbitrum-destination-credits/${op.profileHash}`);
            await this.writeJson(this.path(op), record, true);
            return record;
        });
    }
}
export class RelayArbitrumDestinationObserver {
    root;
    ports;
    records;
    constructor(root, ports) {
        this.root = root;
        this.ports = ports;
        this.records = new CreditRecords(root);
    }
    accepted(record, reason) {
        return { state: "operational_acceptance", reason, providerStatus: record.providerStatus, providerStatusBound: true,
            destinationProof: record.proof, destinationDeliveryProven: true, operationalAcceptance: true, terminal: true };
    }
    open(state, reason, providerStatus = null, providerStatusBound = false, destinationProof = null) {
        return { state, reason, providerStatus, providerStatusBound, destinationProof, destinationDeliveryProven: false,
            operationalAcceptance: false, terminal: false };
    }
    /** `sourceHash` is the deposit the caller just read as confirmed from the operation's own source journal. */
    async observe(op, sourceHash) {
        const draft = op.arbitrumDraft;
        if (draft === undefined || op.statusLocator === undefined)
            return this.open("deposit_source_confirmed", "status_locator_missing");
        const recorded = await this.records.load(op);
        if (recorded !== null)
            return this.accepted(recorded, "recorded_destination_credit");
        let provider;
        try {
            provider = await this.ports.status.statusOf(op);
        }
        catch {
            return this.open("deposit_source_confirmed", "provider_status_unavailable_or_ambiguous");
        }
        const bound = provider.chainIdentityObserved && provider.inTxHashes.includes(sourceHash.toLowerCase());
        if (provider.txHashes.length === 0)
            return this.open("deposit_source_confirmed", "provider_candidate_missing", provider.status, bound);
        if (provider.txHashes.length > 1)
            return this.open("provider_candidate_unproven", "multiple_provider_candidates", provider.status, bound);
        // The saved draft re-projects to the exact quote the operation was prepared from (its own recipient and minimum).
        const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(draft.rawQuote, { payer: draft.owner, recipient: draft.recipient,
            amountAtomic: draft.amountAtomic, minimumOutputAtomic: draft.minimumOutputAtomic, nowSeconds: Math.floor(Date.parse(draft.createdAt) / 1000) });
        if (quote.quoteDigest !== op.quoteDigest || quote.recipient !== op.recipient.toLowerCase())
            corrupt();
        const credit = await proveRelayEthereumUsdcCredit(quote, provider.txHashes[0], this.ports.ethereum());
        if (credit.status !== "recipient_credit_proven")
            return this.open("provider_candidate_unproven", credit.reason, provider.status, bound, { status: credit.status, reason: credit.reason });
        if (provider.status !== "success" || !bound)
            return { ...this.open("recipient_credit_observed", "provider_success_or_source_binding_unproven", provider.status, bound, credit.proof), destinationDeliveryProven: true };
        try {
            await new RelayDestinationClaimRepository(this.root).claimEthereumUsdc(op, sourceHash, credit.proof);
        }
        catch {
            return this.open("provider_candidate_unproven", "destination_payout_claim_conflict", provider.status, bound, credit.proof);
        }
        return this.accepted(await this.records.record(op, sourceHash, credit.proof, this.ports.now?.() ?? new Date()), "source_safe_provider_success_and_canonical_recipient_credit");
    }
}
//# sourceMappingURL=arbitrum-destination.js.map