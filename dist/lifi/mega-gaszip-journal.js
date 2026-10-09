import { hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { MEGA_FUNDING, megaFail, megaHash, megaUint } from "./mega-gaszip-contract.js";
export function sealMegaFunding(body) { const { integrityHash: _old, ...clean } = body; return validateMegaFunding({ ...clean, integrityHash: hashObject(clean) }); }
export function validateMegaFunding(value) {
    const r = value;
    if (r === null || typeof r !== "object")
        megaFail("record");
    const { integrityHash, ...body } = r;
    if (r.schemaVersion !== "apn.mega-gaszip-operation.v1" || hashObject(body) !== integrityHash)
        megaFail("record_integrity");
    for (const s of [r.operationId, r.profileHash, r.idempotencyHash, r.requestHash, r.policyDigest, r.quoteDigest])
        stateIdentifier(s, "GasZip record identity");
    if (r.profile !== MEGA_FUNDING.profile || r.owner.address !== MEGA_FUNDING.owner || r.profileHash !== r.owner.profileHash || r.profile !== r.owner.profile || megaUint(r.amountAtomic) !== MEGA_FUNDING.maximumAmount ||
        megaUint(r.maximumFeeAtomic) > MEGA_FUNDING.maximumFee || megaUint(r.minimumOutputAtomic) < MEGA_FUNDING.minimumOutput ||
        megaUint(r.quoteExpectedAtomic) < megaUint(r.minimumOutputAtomic) || !Number.isFinite(Date.parse(r.expiresAt)) || !Number.isSafeInteger(r.policyRevision) || r.policyRevision < 1)
        megaFail("record_terms");
    megaHash(r.plan.blockHash);
    for (const x of [r.plan.nonce, r.plan.gas, r.plan.maxFee, r.plan.tip, r.plan.l1FeeUpper, r.plan.operatorFeeUpper, r.plan.feeUpper])
        megaUint(x);
    if (megaUint(r.plan.feeUpper) !== megaUint(r.plan.gas) * megaUint(r.plan.maxFee) + megaUint(r.plan.l1FeeUpper) + megaUint(r.plan.operatorFeeUpper) ||
        megaUint(r.plan.feeUpper) > megaUint(r.maximumFeeAtomic) || megaUint(r.plan.tip) > megaUint(r.plan.maxFee))
        megaFail("record_fee");
    const terminal = ["completed", "failed_before_effect", "failed_confirmed_revert"].includes(r.state);
    if (terminal !== r.terminal || !["prepared", "signing_started", "sealed", "submitting", "submitted", "unknown_finality", "completed", "failed_before_effect", "failed_confirmed_revert"].includes(r.state))
        megaFail("record_state");
    if (r.transactionHash === null ? r.rawTransaction !== null : r.rawTransaction === null || keccak256(r.rawTransaction) !== r.transactionHash)
        megaFail("record_transaction");
    if (r.rawTransaction !== null) {
        const t = parseTransaction(r.rawTransaction);
        if (t.type !== "eip1559" || t.chainId !== 8453 || t.to?.toLowerCase() !== MEGA_FUNDING.target.toLowerCase() || t.data !== MEGA_FUNDING.data || t.value !== megaUint(r.amountAtomic) ||
            t.nonce?.toString() !== r.plan.nonce || t.gas?.toString() !== r.plan.gas || t.maxFeePerGas?.toString() !== r.plan.maxFee ||
            t.maxPriorityFeePerGas?.toString() !== r.plan.tip || (t.accessList ?? []).length !== 0 || t.r === undefined || t.s === undefined)
            megaFail("record_envelope");
    }
    if ((r.state === "prepared" || r.state === "signing_started" || r.state === "failed_before_effect") && r.rawTransaction !== null ||
        r.submissionAttempts !== 0 && r.submissionAttempts !== 1 || ["submitting", "submitted", "completed", "failed_confirmed_revert"].includes(r.state) && r.submissionAttempts !== 1 ||
        r.state === "completed" && (r.sourceProof === null || r.destinationProof === null || r.outcomeDigest === null))
        megaFail("record_phase");
    return r;
}
export function publicMegaFunding(r) { const { rawTransaction: _raw, ...rest } = validateMegaFunding(r); return rest; }
export class MegaFundingJournal extends SecureStateStore {
    path(id) { stateIdentifier(id, "GasZip operation"); return `mega-gaszip/${id}.json`; }
    async findOperation(id) { const v = await this.readJson(this.path(id)); return v === null ? null : validateMegaFunding(v); }
    async listAllOperations() { const rows = []; for (const e of await this.readDirectory("mega-gaszip")) {
        if (!e.isFile() || e.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(e.name))
            megaFail("journal_entry");
        const r = await this.findOperation(e.name.slice(0, -5));
        if (r === null)
            megaFail("journal_missing");
        rows.push(r);
    } return rows; }
    async listOperations(profileHash) { return (await this.listAllOperations()).filter(x => x.profileHash === profileHash); }
    async saveLocked(r, create = false) { validateMegaFunding(r); await this.ensureDirectory("mega-gaszip"); await this.writeJson(this.path(r.operationId), r, create); }
    async sealTransaction(r, raw) {
        if (r.state !== "signing_started" || await recoverTransactionAddress({ serializedTransaction: raw }) !== r.owner.address)
            megaFail("signer_binding");
        const sealed = sealMegaFunding({ ...r, state: "sealed", rawTransaction: raw, transactionHash: keccak256(raw) });
        await this.saveLocked(sealed);
        return sealed;
    }
    async assertNoEffectClaimsLocked(r) {
        if (await this.readJson(`mega-gaszip-first-sign/${r.operationId}.json`) !== null || await this.readJson(`mega-gaszip-first-send/${r.operationId}.json`) !== null)
            megaFail("effect_marker_blocks_retirement");
    }
    async claimSigningLocked(r) {
        await this.ensureDirectory("mega-gaszip-first-sign");
        await this.writeJson(`mega-gaszip-first-sign/${r.operationId}.json`, { operationId: r.operationId, fingerprint: r.integrityHash, nonce: r.plan.nonce }, true);
    }
    async claimSendLocked(r) {
        if (r.transactionHash === null)
            megaFail("send_missing_hash");
        await this.ensureDirectory("mega-gaszip-first-send");
        await this.writeJson(`mega-gaszip-first-send/${r.operationId}.json`, { operationId: r.operationId, transactionHash: r.transactionHash }, true);
    }
    async claimDestinationLocked(hash, id) {
        const path = `mega-gaszip-destination-claims/${hash.slice(2)}.json`;
        const prior = await this.readJson(path);
        if (prior !== null) {
            if (prior.operationId !== id)
                megaFail("destination_already_claimed");
            return;
        }
        await this.ensureDirectory("mega-gaszip-destination-claims");
        await this.writeJson(path, { operationId: id, destinationHash: hash }, true);
    }
}
//# sourceMappingURL=mega-gaszip-journal.js.map