import { approvalCode } from "../approval-code.js";
import { ApnError } from "../errors.js";
import { assertGaslessEstimate } from "./economics.js";
import { assertGaslessRemaining, gaslessReason, guardGaslessOperation } from "./guard.js";
import { validateGaslessMaterial } from "./material-validation.js";
import { GaslessObservationService } from "./observation.js";
import { publicGaslessOperation } from "./receipt.js";
import { GASLESS_MIN_REMAINING_MS, gaslessFailure } from "./validation.js";
import { gaslessSignedFees } from "./wire.js";
/** A transient check failure is retried inside the approved window, before a disclosure as well as after one. */
const GUARD_ATTEMPTS = 18, GUARD_RETRY_MS = 5_000;
const TRANSIENT_REASONS = new Set(["gasless_rpc_unavailable", "gasless_bundler_fee_drift",
    "gasless_provider_response", "gasless_mirror_estimate_unavailable"]);
export class GaslessExecution {
    state;
    rpc;
    custody;
    now;
    save;
    wait;
    observation;
    constructor(state, rpc, custody, now, save, wait) {
        this.state = state;
        this.rpc = rpc;
        this.custody = custody;
        this.now = now;
        this.save = save;
        this.wait = wait;
        this.observation = new GaslessObservationService(rpc, save);
    }
    async approve(op, approval) {
        if (op.terminal || op.state !== "awaiting_approval")
            return op;
        try {
            await this.mirror(op, await this.guard(op));
        }
        catch (error) {
            return await this.halt(op, error);
        }
        const accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
            exactPhrase: approvalCode("gasless", op.fingerprint), summary: publicGaslessOperation(op) });
        if (!accepted)
            return await this.save(op, { state: "failed_before_effect", failure: "gasless_approval_rejected" });
        try {
            assertGaslessRemaining(op, this.now());
        }
        catch (error) {
            return await this.halt(op, error);
        }
        op = await this.save(op, { state: "execution_pending", approval: { policy: "apn.gasless.foreground-approval.v1",
                fingerprint: op.fingerprint, approvedAt: this.at(), expiresAt: op.intent.expiresAt } });
        return await this.advance(op, true);
    }
    async run(op) { return await this.advance(op, false); }
    /** `mirrored` is true only on the approval path, which already ran the mirror estimate before the screen. */
    async advance(op, mirrored) {
        if (op.terminal || op.state === "awaiting_approval")
            return op;
        if (op.userOperation.submissionAttempts === 1 || op.state === "failed_effects_pending")
            return await this.observation.run(op);
        if (undisclosed(op) && this.now() >= Date.parse(op.intent.expiresAt)) {
            return await this.save(op, { state: "failed_before_effect", failure: "gasless_action_expired" });
        }
        if (op.bootstrap.disclosureAttempts === 1 && op.bootstrap.estimate === null) {
            return await this.observation.run(await this.unknown(op, "gasless_bootstrap_unresolved"));
        }
        if (this.now() >= Date.parse(op.intent.expiresAt) && op.bootstrap.materialHash !== null &&
            op.userOperation.phase === "sealed" && op.userOperation.signingAttempts === 1 &&
            op.userOperation.materialHash !== null && op.userOperation.userOperationHash !== null &&
            op.userOperation.sealedAt !== null && op.userOperation.disclosureAttempts === 0 &&
            op.userOperation.submissionAttempts === 0 && op.settlement === null) {
            return await this.observation.run(op);
        }
        if (op.bootstrap.materialHash !== null && op.userOperation.signingAttempts === 0 &&
            this.now() >= Date.parse(op.intent.expiresAt)) {
            return await this.observation.run(await this.unknown(op, "gasless_bootstrap_unresolved"));
        }
        if (op.bootstrap.signingAttempts === 0 && !mirrored) {
            try {
                await this.mirror(op, await this.guard(op));
            }
            catch (error) {
                return await this.halt(op, error);
            }
        }
        const bootstrapResult = await this.material(op, "bootstrap");
        op = bootstrapResult.op;
        if (bootstrapResult.material === null)
            return op;
        const bootstrap = bootstrapResult.material;
        if (op.bootstrap.disclosureAttempts === 0) {
            let fees;
            try {
                fees = await this.guard(op);
            }
            catch (error) {
                return await this.halt(op, error);
            }
            op = await this.save(op, { state: "bootstrap_pending", bootstrap: { ...op.bootstrap,
                    phase: "disclosure_started", disclosureAttempts: 1, disclosedAt: this.at() } });
            let estimate;
            try {
                assertGaslessRemaining(op, this.now());
                estimate = await this.rpc.estimate(op.intent, bootstrap, fees);
                assertGaslessEstimate(op.intent, estimate);
            }
            catch (error) {
                return await this.unknown(op, gaslessReason(error, "gasless_bootstrap_unresolved"));
            }
            op = await this.save(op, { bootstrap: { ...op.bootstrap, phase: "checked", estimate }, failure: null });
        }
        if (op.bootstrap.phase !== "checked" || op.bootstrap.estimate === null)
            return await this.unknown(op, "gasless_bootstrap_unresolved");
        const finalResult = await this.material(op, "user_operation", bootstrap);
        op = finalResult.op;
        if (finalResult.material === null)
            return op;
        const material = finalResult.material;
        try {
            await this.guard(op, gaslessSignedFees(op.intent, material.userOperation));
        }
        catch (error) {
            return await this.halt(op, error);
        }
        op = await this.save(op, { state: "user_operation_pending", userOperation: { ...op.userOperation,
                phase: "submitting", submissionAttempts: 1, submittedAt: this.at() }, failure: null });
        let acknowledged = false;
        try {
            assertGaslessRemaining(op, this.now());
            const returned = await this.rpc.send(op.intent, material);
            acknowledged = returned === material.userOperationHash;
        }
        catch { /* A durable first-send marker also owns a lost or malformed response. */ }
        op = await this.save(op, { state: acknowledged ? "submitted_pending" : "unknown_finality",
            userOperation: { ...op.userOperation, phase: acknowledged ? "submitted_pending" : "unknown_finality" },
            failure: acknowledged ? null : "gasless_submission_unknown" });
        // The first-send marker is durable. Finality belongs to an explicit resume/observe invocation
        // with a separate bounded read budget; never turn a submitted response into an inline retry.
        return op;
    }
    async material(op, role, bootstrap) {
        let effect = role === "bootstrap" ? op.bootstrap : op.userOperation;
        if (effect.signingAttempts === 0) {
            let fees;
            try {
                fees = await this.guard(op);
            }
            catch (error) {
                return { op: await this.halt(op, error), material: null };
            }
            effect = { ...effect, phase: "signing_started", signingAttempts: 1, signingStartedAt: this.at() };
            op = await this.save(op, { state: role === "bootstrap" ? "bootstrap_pending" : "user_operation_pending", [this.key(role)]: effect });
            try {
                await this.custody.seal(op, role, op.intent.owner, bootstrap, role === "bootstrap" ? undefined : fees);
            }
            catch { /* Only a completed original seal is recoverable after an attempted signature. */ }
        }
        let material;
        try {
            const loaded = await this.custody.load(op, role);
            if (loaded === null)
                gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_material_missing");
            material = await validateGaslessMaterial(loaded, op, role, bootstrap);
        }
        catch {
            return { op: await this.unknown(op, role === "bootstrap" ? "gasless_bootstrap_unresolved" : "gasless_user_operation_unresolved"), material: null };
        }
        if (effect.materialHash === null || effect.phase === "unknown_finality") {
            // The original seal can be recovered without another signer invocation.
            effect = { ...effect, phase: "sealed", materialHash: material.materialHash,
                sealedAt: effect.sealedAt ?? this.at(), userOperationHash: material.role === "user_operation" ? material.userOperationHash : null };
            op = await this.save(op, { state: role === "bootstrap" ? "bootstrap_pending" : "user_operation_pending",
                [this.key(role)]: effect, failure: null });
        }
        return { op, material };
    }
    /** The same UserOperation signed by a throwaway key must fit the frozen offer before any owner material exists. */
    async mirror(op, fees) {
        await this.steady(op, async () => { await this.rpc.mirrorEstimate(op.intent, fees); });
    }
    key(role) { return role === "bootstrap" ? "bootstrap" : "userOperation"; }
    at() { return new Date(this.now()).toISOString(); }
    async guard(op, signed) {
        return await this.steady(op, async () => await guardGaslessOperation(this.state, this.rpc, op, this.now, signed));
    }
    /**
     * A price spike, rate limit or transport failure is waited out while the approved window still leaves room for the
     * remaining steps. An interrupt, an exhausted window and every definite refusal end the operation at once.
     */
    async steady(op, act) {
        for (let attempt = 1;; attempt += 1) {
            try {
                return await act();
            }
            catch (error) {
                if (attempt >= GUARD_ATTEMPTS || !transient(error) ||
                    Date.parse(op.intent.expiresAt) - this.now() <= GASLESS_MIN_REMAINING_MS + GUARD_RETRY_MS ||
                    await this.wait.wait(GUARD_RETRY_MS) === "interrupted")
                    throw error;
            }
        }
    }
    async halt(op, error) {
        const reason = gaslessReason(error, "gasless_guard_unavailable");
        if (op.bootstrap.signingAttempts === 0 && op.userOperation.signingAttempts === 0) {
            return await this.save(op, { state: "failed_before_effect", failure: reason });
        }
        return await this.unknown(op, reason);
    }
    async unknown(op, reason) {
        // Material that never left custody cannot produce an effect, so it must not hold the profile guard.
        return await this.save(op, { state: undisclosed(op) ? "failed_before_effect" : "unknown_finality", failure: reason });
    }
}
function transient(error) {
    const reason = gaslessReason(error, "");
    if (TRANSIENT_REASONS.has(reason))
        return true;
    // A quote above the owner cap can fall back inside it; a balance below the transfer cannot.
    return reason === "gasless_fee_budget" && error instanceof ApnError && error.code === "APN_FEE_BUDGET_EXCEEDED";
}
function undisclosed(op) {
    return op.bootstrap.disclosureAttempts === 0 && op.userOperation.disclosureAttempts === 0 &&
        op.userOperation.submissionAttempts === 0 && op.settlement === null;
}
//# sourceMappingURL=execution.js.map