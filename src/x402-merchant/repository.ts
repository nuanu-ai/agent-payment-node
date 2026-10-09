import { canonicalJson } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateMerchant, type MerchantOperation } from "./model.js";
import { refuse } from "./protocol.js";
export class MerchantRepository extends SecureStateStore {
    private path(id: string) { stateIdentifier(id, "merchant operation"); return `merchant-x402/${id}.json`; }
    async findOperation(id: string): Promise<MerchantOperation | null> { const v = await this.readJson(this.path(id)); if (v === null)
        return null; const o = validateMerchant(v); if (o.operationId !== id)
        refuse("merchant_path_binding"); return o; }
    async listAllOperations() { const out: MerchantOperation[] = []; for (const f of await this.readDirectory("merchant-x402")) {
        if (!f.isFile() || !/^[a-f0-9]{64}\.json$/u.test(f.name))
            refuse("merchant_directory_entry");
        const o = await this.findOperation(f.name.slice(0, -5));
        if (o === null)
            refuse("merchant_directory_entry");
        out.push(o);
    } return out; }
    async listOperations(profileHash: string) { return (await this.listAllOperations()).filter(o => o.profileHash === profileHash); }
    /** Caller holds profile/operation/idempotency/account locks. Append continuity forbids resets or resend. */
    async persist(o: MerchantOperation): Promise<void> {
        validateMerchant(o);
        await this.initialize();
        await this.ensureDirectory("merchant-x402");
        const prior = await this.findOperation(o.operationId);
        const edges: Record<MerchantOperation["state"], readonly MerchantOperation["state"][]> = { prepared:["signing_started"], signing_started:["submission_started","unknown_finality"], submission_started:["unknown_finality","payment_finalized","reverted"], unknown_finality:["payment_finalized","reverted"], payment_finalized:["delivery_unknown"], delivery_unknown:["delivered"], delivered:[], reverted:[] };
        if (prior !== null && (prior.state !== o.state && !edges[prior.state].includes(o.state) ||prior.fingerprint !== o.fingerprint || prior.signingAttempts > o.signingAttempts || prior.submissionAttempts > o.submissionAttempts ||
            prior.txHash !== null && prior.txHash !== o.txHash || prior.receipt !== null && canonicalJson(prior.receipt) !== canonicalJson(o.receipt) ||
            prior.terminal && prior.integrityHash !== o.integrityHash || canonicalJson(o.events.slice(0, prior.events.length)) !== canonicalJson(prior.events) ||
            canonicalJson(o.deliveryAttempts.slice(0, prior.deliveryAttempts.length)) !== canonicalJson(prior.deliveryAttempts)))
            refuse("merchant_journal_append");
        if (prior === null && (o.state !== "prepared" || o.signingAttempts !== 0 || o.submissionAttempts !== 0 || o.txHash !== null || o.receipt !== null || o.deliveryAttempts.length !== 0))
            refuse("merchant_journal_create");
        await this.writeJson(this.path(o.operationId), o, prior === null);
    }
}
