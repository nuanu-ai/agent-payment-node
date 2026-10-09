import { bindMerchantMaterial, bindMerchantFeeAdmission, issueMerchantAuthority, assertMerchantAuthority, disposeMerchantAuthority } from "./authority.js";
import { appendMerchantFailure } from "./failure.js";
import { MerchantRetirement } from "./retirement.js";
import { MerchantClaims } from "./claims.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { evmNativeCustody } from "../evm-native-custody.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { merchantFingerprint, merchantMove, merchantSnapshot, sealMerchant } from "./model.js";
import { MerchantRepository } from "./repository.js";
import { MerchantOwner } from "./owner.js";
import { checkMerchantEnvelope, merchantCurrent, merchantReceipt, hexHash } from "./rpc.js";
import {} from "./custody.js";
import { merchantChallenge, merchantPrice, merchantProof, refuse } from "./protocol.js";
import { MERCHANT_AMOUNT, MERCHANT_OWNER, MERCHANT_URL } from "./pins.js";
export class MerchantService {
    state;
    ports;
    records;
    operations;
    owner;
    constructor(state, ports) {
        this.state = state;
        this.ports = ports;
        this.records = new MerchantRepository(state.root);
        this.operations = new OperationService(state);
        this.owner = new MerchantOwner(state, ports.now);
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), key = canonicalIdempotencyKey(input.idempotencyKey), maximumNativeFee = input.maximumNativeFee;
        if (!/^[1-9][0-9]*$/u.test(maximumNativeFee) || BigInt(maximumNativeFee) > 10n ** 18n)
            refuse("merchant_fee_ceiling");
        const profileHash = this.state.profileHash(profile), operationId = this.state.operationId(profile, key), idempotencyHash = this.state.idempotencyHash(key), requestHash = hashObject({ kind: "merchant_x402", profile, url: MERCHANT_URL, maximumNativeFee, ...(input.nativeFeeReserveWei === undefined ? {} : { nativeFeeReserveWei: input.nativeFeeReserveWei }) });
        await this.state.initialize();
        return this.state.withLocks(this.locks(profileHash, operationId, idempotencyHash), async () => {
            const existing = await this.operations.resolvePrepare({ kind: "merchant_x402", profileHash, operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "merchant_x402")
                    refuse("merchant_idempotency_kind");
                return existing.record;
            }
            const custody = await evmNativeCustody(this.state, profile);
            if (custody.walletAddress !== MERCHANT_OWNER)
                refuse("merchant_finite_owner");
            await assertExclusiveEvmRawSigner(this.state, MERCHANT_OWNER, profileHash);
            await this.operations.assertEvmAccountAvailable(profileHash, 4326, MERCHANT_OWNER);
            const policy = await this.owner.admit(profile), observation = await this.ports.http.get({ url: MERCHANT_URL }), frozen = merchantChallenge(observation), current = await merchantCurrent(this.ports.rpc, undefined, maximumNativeFee);
            const createdAt = this.ports.now().toISOString();
            if (Date.parse(createdAt) - Date.parse(observation.observedAt) > 30000 || Date.parse(createdAt) < Date.parse(observation.observedAt))
                refuse("merchant_challenge_read_age");
            const envelope = { nonce: current.nonce, gas: current.gas, maxFeePerGas: current.maxFeePerGas, maxPriorityFeePerGas: current.maxPriorityFeePerGas, maximumNativeFee, ...(input.nativeFeeReserveWei === undefined ? {} : { nativeFeeReserveWei: input.nativeFeeReserveWei }) };
            checkMerchantEnvelope(current, envelope, current.feeContext);
            if (BigInt(current.token) < BigInt(MERCHANT_AMOUNT))
                refuse("merchant_usdm_balance");
            const effectBinding = await this.owner.effectBinding(profile, envelope.nativeFeeReserveWei ?? current.feeContext.admissionEstimatedUpper, new Date(Date.parse(createdAt) + 300000).toISOString());
            const body = { feeContext: current.feeContext, effectBinding, schemaVersion: "apn.x402-merchant.v1", kind: "merchant_x402", operationId, profile, profileHash, idempotencyHash, requestHash, custody, frozen, envelope, policy, createdAt, expiresAt: new Date(Date.parse(createdAt) + 300000).toISOString(), state: "prepared", terminal: false, signingAttempts: 0, submissionAttempts: 0, txHash: null, receipt: null, deliveryAttempts: [], events: [{ at: createdAt, state: "prepared", previousHash: null, snapshotHash: merchantSnapshot({ state: "prepared", signingAttempts: 0, submissionAttempts: 0, txHash: null, receipt: null, deliveryAttempts: [] }), eventHash: hashObject({ at: createdAt, state: "prepared", previousHash: null, snapshotHash: merchantSnapshot({ state: "prepared", signingAttempts: 0, submissionAttempts: 0, txHash: null, receipt: null, deliveryAttempts: [] }) }) }] };
            const o = sealMerchant({ ...body, fingerprint: merchantFingerprint(body) });
            await this.records.persist(o);
            return o;
        });
    }
    async approve(id) {
        const found = await this.required(id);
        return this.state.withLocks(this.locks(found.profileHash, found.operationId, found.idempotencyHash), () => this.owner.withPolicyLock(found.profile, async (owner) => {
            let o = await this.required(id);
            if (o.state !== "prepared" || o.signingAttempts !== 0 || o.submissionAttempts !== 0)
                refuse("merchant_once_only_approval");
            if (this.ports.approve === undefined || this.ports.custody === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "The pinned USDm payment requires foreground CLI confirmation.");
            if (o.feeContext === undefined)
                refuse("merchant_new_full_fee_context_required");
            if (o.effectBinding === undefined)
                refuse("merchant_new_effect_binding_required");
            const claims = new MerchantClaims(this.state.root);
            await claims.assertUnused(o);
            await this.revalidate(o, owner);
            await this.ports.approve(o);
            const approvalEndsAt = new Date(this.ports.now().getTime() + 60000).toISOString(); // Capture immediately; asynchronous work cannot renew foreground consent.
            await this.revalidate(o, owner);
            this.consentFresh(o, approvalEndsAt);
            await claims.assertUnused(o);
            await owner.reserve(o);
            this.consentFresh(o, approvalEndsAt);
            o = merchantMove(o, "signing_started", this.at(), { signingAttempts: 1 });
            await this.records.persist(o);
            await owner.follow(o, "unknown_finality");
            await claims.claim(o, "sign");
            const holds = await owner.held(o), grant = issueMerchantAuthority(this, o, holds.token, holds.native, approvalEndsAt);
            // No path after this durable fence may invoke custody again, including a crash before the signature returns.
            let phase = "pre_custody_fee";
            try {
                await this.refreshFee(o, grant);
                assertMerchantAuthority(grant, this, o, this.ports.now());
                phase = "custody";
                const raw = await this.ports.custody.sign(o, grant, this, () => this.refreshFee(o, grant));
                phase = "verify";
                const txHash = await this.ports.custody.verify(o, raw);
                bindMerchantMaterial(grant, this, o, this.ports.now(), hashObject({ raw, txHash, fingerprint: o.fingerprint }));
                phase = "seal";
                await this.ports.custody.seal(o, raw);
                this.fresh(o);
                assertMerchantAuthority(grant, this, o, this.ports.now());
                await owner.confirm(o);
                await owner.held(o);
                phase = "post_seal_fee";
                await this.refreshFee(o, grant);
                phase = "challenge";
                if (canonicalJson(merchantChallenge(await this.ports.http.get({ url: MERCHANT_URL }))) !== canonicalJson(o.frozen))
                    refuse("merchant_challenge_changed_after_sealing");
                this.fresh(o);
                assertMerchantAuthority(grant, this, o, this.ports.now());
                phase = "send_claim";
                await claims.claim(o, "send", txHash);
                assertMerchantAuthority(grant, this, o, this.ports.now(), "send");
                o = merchantMove(o, "submission_started", this.at(), { submissionAttempts: 1, txHash });
                await this.records.persist(o);
                phase = "send_wire";
                const sent = hexHash(await this.ports.rpc.call("eth_sendRawTransaction", [raw], async () => { this.fresh(o); await owner.confirm(o); await owner.held(o); assertMerchantAuthority(grant, this, o, this.ports.now()); }, () => { this.fresh(o); assertMerchantAuthority(grant, this, o, this.ports.now()); }));
                if (sent !== txHash)
                    refuse("merchant_send_hash_mismatch");
            }
            catch (error) {
                o = appendMerchantFailure(o, error, phase, this.at());
                o = merchantMove(o, "unknown_finality", this.at());
                await this.records.persist(o);
                return o;
            }
            finally {
                disposeMerchantAuthority(grant);
            }
            o = merchantMove(o, "unknown_finality", this.at());
            await this.records.persist(o);
            return await this.observeLocked(o, true);
        }));
    }
    async observe(id, deliver = false) {
        const found = await this.required(id);
        return this.state.withLocks(this.locks(found.profileHash, found.operationId, found.idempotencyHash), async () => this.observeLocked(await this.required(id), deliver));
    }
    async retireUnsent(id) { return new MerchantRetirement(this.state, this.ports.rpc, this.ports.now).retire(id); }
    async status(id) { return await this.required(id); }
    async observeLocked(o, deliver) {
        if (o.submissionAttempts !== 1 || o.txHash === null)
            refuse("merchant_observer_has_no_transaction_claim");
        let receipt;
        try {
            receipt = await merchantReceipt(this.ports.rpc, o);
        }
        catch (error) {
            const reason = error instanceof ApnError && typeof error.details?.reason === "string" ? error.details.reason : "merchant_canonical_unavailable";
            return await this.canonicalAudit(o, reason.startsWith("merchant_receipt_") ? "mismatch" : "unavailable", reason, null);
        }
        if (receipt === null)
            return await this.canonicalAudit(o, "unavailable", "merchant_canonical_not_finalized", null);
        if (o.receipt !== null && !sameReceiptEffect(o.receipt, receipt))
            return await this.canonicalAudit(o, "mismatch", "merchant_saved_receipt_changed", receipt);
        if (o.receipt === null) {
            o = merchantMove(o, receipt.status === "success" ? "payment_finalized" : "reverted", this.at(), { receipt });
            await this.records.persist(o);
        }
        o = await this.canonicalAudit(o, "verified", "merchant_canonical_verified", receipt);
        // Never infer new finalization from an old saved receipt. The original receipt and verdict remain immutable.
        await this.owner.follow(o, receipt.status === "success" ? "finalized" : "failed_confirmed_revert", receipt);
        if (o.terminal || receipt.status !== "success" || !deliver)
            return o;
        if (o.deliveryAttempts.length % 2 === 1) {
            const dangling = o.deliveryAttempts.at(-1);
            o = merchantMove(o, "delivery_unknown", this.at(), { deliveryAttempts: [...o.deliveryAttempts, { at: this.at(), proofHash: dangling.proofHash, outcome: "unknown" }] });
            await this.records.persist(o);
        }
        // Only this explicit observer flag retries delivery. It always uses the original transaction, never pays again.
        if (o.deliveryAttempts.length >= 16)
            refuse("merchant_delivery_retry_limit");
        // Reobserve after accounting awaits and immediately before disclosing the original proof.
        const beforeDelivery = await this.refreshCanonical(o);
        o = beforeDelivery.operation;
        if (!beforeDelivery.verified)
            return o;
        const proof = merchantProof(o.frozen, o.txHash), proofHash = hashObject(proof), at = this.at();
        o = merchantMove(o, "delivery_unknown", at, { deliveryAttempts: [...o.deliveryAttempts, { at, proofHash, outcome: "started" }] });
        await this.records.persist(o);
        let response;
        try {
            response = await this.ports.http.get({ url: MERCHANT_URL, paymentSignature: proof });
            const result = merchantPrice(response), bodyHash = hashObject(Buffer.from(response.bodyBytes).toString("base64"));
            o = merchantMove(o, "delivered", this.at(), { deliveryAttempts: [...o.deliveryAttempts, { at: this.at(), proofHash, outcome: "delivered", httpStatus: response.status, bodyHash, headers: response.rawHeaderPairs, result }] });
        }
        catch {
            o = merchantMove(o, "delivery_unknown", this.at(), { deliveryAttempts: [...o.deliveryAttempts, { at: this.at(), proofHash, outcome: "unknown", ...(response === undefined ? {} : { httpStatus: response.status, bodyHash: hashObject(Buffer.from(response.bodyBytes).toString("base64")), headers: response.rawHeaderPairs }) }] });
        }
        await this.records.persist(o);
        // Keep a successful HTTP200 fact even if a subsequent chain proof changes.
        return (await this.refreshCanonical(o)).operation;
    }
    async refreshCanonical(o) {
        try {
            const fresh = await merchantReceipt(this.ports.rpc, o);
            if (fresh === null)
                return { operation: await this.canonicalAudit(o, "unavailable", "merchant_canonical_not_finalized", null), verified: false };
            const verified = o.receipt !== null && sameReceiptEffect(o.receipt, fresh);
            return { operation: await this.canonicalAudit(o, verified ? "verified" : "mismatch", verified ? "merchant_canonical_verified" : "merchant_saved_receipt_changed", fresh), verified };
        }
        catch (error) {
            const reason = error instanceof ApnError && typeof error.details?.reason === "string" ? error.details.reason : "merchant_canonical_unavailable";
            return { operation: await this.canonicalAudit(o, reason.startsWith("merchant_receipt_") ? "mismatch" : "unavailable", reason, null), verified: false };
        }
    }
    async canonicalAudit(o, result, reason, receipt) {
        if (o.receipt === null)
            return o;
        const body = { result, reason, chain: "eip155:4326", origin: "https://mainnet.megaeth.com",
            priorReceiptHash: hashObject(o.receipt), deliveryCount: o.deliveryAttempts.length, priorDeliveryHash: hashObject(o.deliveryAttempts),
            currentReceiptHash: receipt === null ? null : hashObject(receipt), currentAnchors: receipt?.canonical ?? null };
        const prior = o.canonicalObservations?.at(-1);
        if (prior !== undefined) {
            const { at: _, previousHash: __, observationHash: ___, ...priorBody } = prior;
            if (canonicalJson(priorBody) === canonicalJson(body))
                return o;
        }
        const observations = o.canonicalObservations ?? [];
        if (observations.length >= 128)
            refuse("merchant_canonical_audit_limit");
        const audit = { ...body, at: this.at(), previousHash: prior?.observationHash ?? null };
        const { integrityHash: _, ...original } = o;
        const updated = sealMerchant({ ...original, canonicalObservations: [...observations, { ...audit, observationHash: hashObject(audit) }] });
        await this.records.persist(updated);
        return updated;
    }
    async revalidate(o, owner = this.owner) {
        this.fresh(o);
        await owner.confirm(o);
        await this.operations.assertMerchantAccountAvailable(o);
        const current = await merchantCurrent(this.ports.rpc, o.envelope);
        checkMerchantEnvelope(current, o.envelope, o.feeContext);
        const fresh = merchantChallenge(await this.ports.http.get({ url: MERCHANT_URL }));
        if (canonicalJson(fresh) !== canonicalJson(o.frozen))
            refuse("merchant_challenge_changed");
        this.fresh(o);
    }
    async refreshFee(o, grant) {
        const started = this.ports.now();
        this.fresh(o);
        const current = await merchantCurrent(this.ports.rpc, o.envelope);
        checkMerchantEnvelope(current, o.envelope, o.feeContext);
        bindMerchantFeeAdmission(grant, this, o, current.feeContext, started, this.ports.now());
    }
    consentFresh(o, approvalEndsAt) { this.fresh(o); if (o.effectBinding === undefined || this.at() >= approvalEndsAt || this.at() >= o.effectBinding.policyEndsAt)
        refuse("merchant_foreground_authority_required_or_expired"); }
    fresh(o) {
        if (this.at() >= o.expiresAt || this.at().slice(0, 10) !== o.createdAt.slice(0, 10))
            refuse("merchant_local_deadline_expired");
    }
    at() { return this.ports.now().toISOString(); }
    locks(profileHash, id, idempotencyHash) { return [`profile:${profileHash}`, `operation:${id}`, `operation:idempotency:${idempotencyHash}`, evmAddressLock(MERCHANT_OWNER)]; }
    async required(id) {
        const o = await this.records.findOperation(canonicalOperationId(id));
        if (o === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Pinned merchant operation was not found.");
        return o;
    }
}
export function sameReceiptEffect(saved, fresh) {
    for (const key of ["transactionHash", "blockNumber", "blockHash", "status", "networkFeeWei"])
        if (saved[key] !== fresh[key])
            return false;
    if (saved.fullFee !== undefined && canonicalJson(saved.fullFee) !== canonicalJson(fresh.fullFee))
        return false;
    return saved.canonical === undefined || saved.canonical.transactionIndex === fresh.canonical?.transactionIndex && saved.canonical.blockHeaderHash === fresh.canonical?.blockHeaderHash;
}
//# sourceMappingURL=service.js.map