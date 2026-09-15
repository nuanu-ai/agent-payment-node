import { approvalCode } from "../approval-code.js";
import { domainHash } from "../canonical.js";
import { assertGaslessOwner } from "../gasless/owner.js";
import { facilitatorFail, facilitatorReason } from "./failure.js";
import { FACILITATOR_EXPOSED, FACILITATOR_POLICY } from "./operation-model.js";
import { publicFacilitatorOperation } from "./receipt.js";
import { facilitatorAuthorizationDigest, newFacilitatorAuthorization } from "./requirement.js";
/** Validity the authorization must still have when it leaves APN, so the facilitator can verify and settle it. */
const EXPOSURE_MARGIN_SECONDS = 60n;
export class FacilitatorExecution {
    state;
    rpc;
    facilitator;
    signer;
    now;
    save;
    constructor(state, rpc, facilitator, signer, now, save) {
        this.state = state;
        this.rpc = rpc;
        this.facilitator = facilitator;
        this.signer = signer;
        this.now = now;
        this.save = save;
    }
    async approve(op, approval) {
        if (op.terminal || op.state !== "awaiting_approval")
            return op;
        if (this.expired(op))
            return await this.save(op, { state: "failed_before_effect", failure: "facilitator_gasless_expired" });
        const accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
            exactPhrase: approvalCode("gasless", op.fingerprint), summary: publicFacilitatorOperation(op) });
        if (!accepted)
            return await this.save(op, { state: "failed_before_effect", failure: "facilitator_gasless_approval_rejected" });
        let startBlock;
        try {
            startBlock = await this.guard(op);
        }
        catch (error) {
            return await this.save(op, { state: "failed_before_effect", failure: facilitatorReason(error, "facilitator_gasless_guard") });
        }
        const authorization = newFacilitatorAuthorization(op.intent.owner.address.toLowerCase(), op.intent.requirement, this.now());
        const signed = { authorization, digest: facilitatorAuthorizationDigest(authorization), startBlock, signatureHash: null };
        op = await this.save(op, { state: "approved", signed, failure: null, approval: { policy: FACILITATOR_POLICY,
                fingerprint: op.fingerprint, approvedAt: this.at(), expiresAt: op.intent.expiresAt } });
        let signature;
        try {
            signature = await this.signer.sign(op);
            if (BigInt(Math.floor(this.now() / 1000)) + EXPOSURE_MARGIN_SECONDS > BigInt(authorization.validBefore)) {
                facilitatorFail("facilitator_gasless_expired");
            }
        }
        catch (error) {
            return await this.save(op, { state: "failed_before_effect", failure: facilitatorReason(error, "facilitator_gasless_signing") });
        }
        // Durable exposure marker: from here on only finalized chain evidence can close the operation.
        op = await this.save(op, { state: "verify_started", verify: this.exchange(), signed: { ...signed,
                signatureHash: domainHash("apn.facilitator-gasless.signature.v1", Buffer.from(signature.slice(2), "hex")) } });
        const payment = { requirement: op.intent.requirement, authorization, signature };
        try {
            const verified = await this.facilitator.verify(payment);
            op = await this.save(op, { verify: { ...op.verify, responseHash: verified.responseHash, outcome: "accepted" } });
        }
        catch (error) {
            const reason = facilitatorReason(error, "facilitator_gasless_provider_unavailable");
            op = await this.save(op, { failure: reason,
                verify: { ...op.verify, outcome: reason === "facilitator_gasless_verify_rejected" ? "rejected" : "unknown" } });
            return await this.reconcile(op);
        }
        op = await this.save(op, { state: "settle_started", settle: this.exchange(), failure: null });
        try {
            const settled = await this.facilitator.settle(payment);
            op = await this.save(op, { state: settled.transactionHash === null ? "settle_started" : "settle_submitted", settle: { ...op.settle,
                    responseHash: settled.responseHash, transactionHash: settled.transactionHash, outcome: settled.pending ? "pending" : "accepted" } });
        }
        catch (error) {
            const reason = facilitatorReason(error, "facilitator_gasless_provider_unavailable");
            op = await this.save(op, { failure: reason,
                settle: { ...op.settle, outcome: reason === "facilitator_gasless_settle_unknown" ? "rejected" : "unknown" } });
        }
        return await this.reconcile(op);
    }
    /** Recovery never signs, verifies or settles again. */
    async run(op) {
        if (op.terminal)
            return op;
        if (op.state === "awaiting_approval") {
            return this.expired(op) ? await this.save(op, { state: "failed_before_effect", failure: "facilitator_gasless_expired" }) : op;
        }
        // Nothing leaves APN before the exposure marker, so an interrupted approval cannot have an effect.
        if (op.state === "approved")
            return await this.save(op, { state: "failed_before_effect", failure: "facilitator_gasless_unexposed" });
        return await this.reconcile(op);
    }
    async reconcile(op) {
        if (op.terminal || !FACILITATOR_EXPOSED.includes(op.state) || op.signed === null)
            return op;
        const { authorization, startBlock } = op.signed, owner = op.intent.owner.address;
        const query = { owner, recipient: op.intent.request.recipient, amountAtomic: op.intent.request.grossAtomic, nonce: authorization.nonce };
        try {
            const rpc = this.rpc(), source = { rpcOrigin: rpc.rpcOrigin, rpcEndpointHash: rpc.rpcEndpointHash };
            await rpc.assertChain();
            // A facilitator-reported hash is only a hint; the on-chain authorization state below stays authoritative.
            const hint = op.settle?.transactionHash ?? op.observation?.transactionHash ?? null;
            const hinted = hint === null ? null : await rpc.settledTransfer({ ...query, transactionHash: hint }).catch(() => null);
            if (hinted !== null)
                return await this.complete(op, hinted, source);
            const finalized = await rpc.finalized(), validBefore = BigInt(authorization.validBefore);
            if (!await rpc.authorizationUsed(owner, authorization.nonce, finalized)) {
                if (BigInt(finalized.timestampAtomic) < validBefore)
                    return op;
                return await this.save(op, { state: "expired_unused", failure: null, observation: { observedAt: this.at(), ...source,
                        finalized, authorizationUsed: false, transactionHash: null } });
            }
            const found = await rpc.findAuthorizationLog(owner, authorization.nonce, startBlock, finalized, validBefore);
            if (found === null || found === "ambiguous")
                return facilitatorFail("facilitator_gasless_evidence");
            const evidence = await rpc.settledTransfer({ ...query, transactionHash: found });
            if (evidence !== null)
                return await this.complete(op, evidence, source);
            return await this.save(op, { observation: { observedAt: this.at(), ...source, finalized, authorizationUsed: true,
                    transactionHash: found } });
        }
        catch (error) {
            return await this.save(op, { failure: facilitatorReason(error, "facilitator_gasless_rpc_unavailable") });
        }
    }
    async complete(op, evidence, source) {
        return await this.save(op, { state: "completed", failure: null, settlement: { ...evidence, ...source, observedAt: this.at() } });
    }
    async guard(op) {
        if (this.expired(op))
            facilitatorFail("facilitator_gasless_expired");
        await assertGaslessOwner(this.state, { owner: op.intent.owner, providerBinding: op.intent.providerBinding });
        const rpc = this.rpc();
        await rpc.assertChain();
        const block = await rpc.finalized();
        if (await rpc.usdcBalance(op.intent.owner.address, block) < BigInt(op.intent.request.grossAtomic)) {
            facilitatorFail("facilitator_gasless_balance");
        }
        await this.facilitator.supported();
        return block;
    }
    expired(op) { return this.now() >= Date.parse(op.intent.expiresAt); }
    exchange() { return { startedAt: this.at(), responseHash: null, transactionHash: null, outcome: "unknown" }; }
    at() { return new Date(this.now()).toISOString(); }
}
//# sourceMappingURL=execution.js.map