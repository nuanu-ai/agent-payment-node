import { GaslessFirstSendAuthority, assertSealedFirstSend } from "./first-send-authority.js";
import { checkGaslessCurrentState, gaslessReason } from "./guard.js";
import { validateGaslessMaterial } from "./material-validation.js";
import { gaslessFailure } from "./validation.js";
import { gaslessSignedFees } from "./wire.js";
/** A dedicated first-send path. It cannot sign, estimate, extend the original frame, or replay a fence. */
export class GaslessSealedFirstSendExecution {
    state;
    rpc;
    custody;
    policy;
    now;
    save;
    authority;
    constructor(state, rpc, custody, policy, now, save) {
        this.state = state;
        this.rpc = rpc;
        this.custody = custody;
        this.policy = policy;
        this.now = now;
        this.save = save;
        this.authority = new GaslessFirstSendAuthority(state.root, this, now);
    }
    async approve(op, approval) {
        if (op.terminal || this.now() < Date.parse(op.intent.expiresAt))
            gaslessFailure("APN_OPERATION_BLOCKED", "gasless_sealed_first_send_ineligible");
        assertSealedFirstSend(op);
        // Only original custody bytes are loaded and validated, before any approval screen.
        const bootstrap = await validateGaslessMaterial(await this.custody.load(op, "bootstrap"), op, "bootstrap");
        const material = await validateGaslessMaterial(await this.custody.load(op, "user_operation"), op, "user_operation", bootstrap);
        const signed = gaslessSignedFees(op.intent, material.userOperation);
        const guard = async () => {
            assertSealedFirstSend(op);
            await this.policy.assertSealedFirstSend(op);
            await checkGaslessCurrentState(this.state, this.rpc, op, signed);
            await this.policy.assertSealedFirstSend(op);
        };
        await guard(); // Refusals before fresh consent cannot grant any authority.
        const proof = await this.authority.approve(op, approval);
        if (proof === null)
            return op;
        try {
            const consent = this.authority.metadata(proof);
            op = await this.save(op, { firstSendApprovals: [...(op.firstSendApprovals ?? []), consent] });
            try {
                this.authority.assert(proof, op);
                await guard();
                this.authority.assert(proof, op);
            }
            catch (error) {
                return await this.save(op, { state: "unknown_finality", failure: gaslessReason(error, "gasless_sealed_first_send_refused") });
            }
            this.authority.claim(proof, op);
            op = await this.save(op, { state: "user_operation_pending", failure: null,
                userOperation: { ...op.userOperation, phase: "submitting", submissionAttempts: 1,
                    submittedAt: new Date(this.now()).toISOString() } });
            let acknowledged = false;
            try {
                this.authority.assert(proof, op, true);
                const returned = await this.rpc.send(op.intent, material, () => this.authority.assert(proof, op, true));
                acknowledged = returned === material.userOperationHash;
            }
            catch { /* The permanent first-send fence owns every lost response or queued refusal. */ }
            return await this.save(op, { state: acknowledged ? "submitted_pending" : "unknown_finality",
                userOperation: { ...op.userOperation, phase: acknowledged ? "submitted_pending" : "unknown_finality" },
                failure: acknowledged ? null : "gasless_submission_unknown" });
        }
        finally {
            this.authority.revoke(proof);
        }
    }
}
//# sourceMappingURL=first-send-execution.js.map