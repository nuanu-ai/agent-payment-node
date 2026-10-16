import { canonicalJson, domainHash, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { rpcAtomic, SolanaRpc, solanaSignature } from "../../solana/rpc.js";
import { detached } from "./v1-admission.js";
import { createJupiterV1ExecutionBinding, JupiterV1LocalSigner } from "./v1-effects.js";
import { guardJupiterV1WhirlpoolMaterial, validateJupiterV1GuardedMaterial } from "./v1-guard.js";
import { validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt } from "./v1-proof.js";
import { JupiterV1MaterialResolver } from "./v1-resolver.js";
import { routeConfigForMaterial } from "./v1-route-config.js";
import { JupiterV1DispatchStore, jupiterV1DispatchResult } from "./v1-dispatch.js";
import { JupiterV1ExecutionFailureStore } from "./v1-execution-failure.js";
import { proveSolanaUnlanded } from "../unlanded.js";
/** The public sender reloads durable ownership and consumes its fsynced create-only claim under the operation lock. */
export class JupiterV1SingleSender {
    core;
    materials;
    bindings;
    native;
    rpc;
    clock;
    constructor(core, materials, bindings, native, rpc, clock) {
        this.core = core;
        this.materials = materials;
        this.bindings = bindings;
        this.native = native;
        this.rpc = rpc;
        this.clock = clock;
        JupiterV1LocalSigner.assertGenuine(native, core.operations.root);
    }
    async sendOnce(operationId) {
        return await this.core.operations.withLocks([`jupiter-v1-operation:${operationId}`], async () => {
            const op = await this.core.operations.loadAny(operationId);
            if (op === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Jupiter operation was not found.");
            if (op.state !== "submitting" || op.submissionMarker === null || await this.bindings.loadClaim(op) !== null)
                blocked("Jupiter's first send is already consumed or unavailable.");
            const material = await this.materials.load(op.quote.quoteHash);
            if (material === null)
                corrupt();
            const binding = await this.bindings.load(op, material);
            if (binding === null)
                corrupt();
            let observedHeight = null;
            try {
                const { fresh } = await this.bindings.loadFresh(op, binding);
                await validateJupiterV1GuardedMaterial(await guardJupiterV1WhirlpoolMaterial(fresh, { deadline: op.quote.expiresAt }));
                const effect = await this.native.savedEffect(op, binding);
                if (effect === null)
                    corrupt();
                const height = rpcAtomic(await this.rpc.call("getBlockHeight", [{ commitment: "confirmed" }]));
                observedHeight = height.toString();
                if (height > BigInt(fresh.lifetime.lastValidBlockHeight))
                    blocked("Jupiter's frozen blockhash expired before send.");
                const at = this.clock.now();
                if (at.toISOString() >= op.quote.expiresAt || at.getTime() - Date.parse(binding.checkedAt) > 30000 || this.rpc.budget === undefined ||
                    this.rpc.budget.remainingPhysicalRequests < 1 || !this.rpc.hasPersistentPacer)
                    blocked("Jupiter send freshness or runtime RPC budget is unavailable.");
                // Persist before any transport. A crash from here permanently makes this operation observe-only.
                await this.native.assertDispatchAdmission(op, binding);
                await this.bindings.claim(op, binding, effect, at);
                let state = "unknown_finality", dispatch = jupiterV1DispatchResult("signature_mismatch");
                try {
                    const returned = await this.rpc.sendTransactionAtStart([effect.rawPayload, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }], async () => {
                        await this.native.assertDispatchAdmission(op, binding);
                        if (this.clock.now().toISOString() >= op.quote.expiresAt || this.clock.now().getTime() - Date.parse(binding.checkedAt) > 30000)
                            blocked("Jupiter expired before physical send.");
                    });
                    if (solanaSignature(returned) === effect.transactionId) {
                        state = "submitted";
                        dispatch = jupiterV1DispatchResult("acknowledged");
                    }
                }
                catch (error) {
                    dispatch = jupiterV1DispatchResult("error", error); /* The permanent claim remains consumed even when transport is ambiguous. */
                }
                await new JupiterV1DispatchStore(this.core.operations.root).save(op, binding.bindingHash, dispatch, this.clock.now());
                return await this.core.recordPossibleSend(op, state, this.clock.now());
            }
            catch (error) {
                // A diagnostic cannot release the marked lease or restore a first-send grant.
                if (await this.bindings.loadClaim(op) === null)
                    await new JupiterV1ExecutionFailureStore(this.core.operations.root).save(op, "sender_preflight", error, material.execution.lifetime.lastValidBlockHeight, observedHeight, this.clock.now());
                throw error;
            }
        });
    }
}
/**
 * Every program-byte, account and simulation check that can fail runs before consent, against the same frozen message.
 * After the prompt only the lifetime reserve, the local owner re-check, the marker, the signature and the one send remain,
 * so the frozen blockhash is not spent on bulky public reads after the human typed the code.
 */
export async function proveJupiterV1Preconsent(rpc, clock, op, materialValue) {
    const material = validateJupiterV1PreparedMaterial(materialValue);
    const fresh = await new JupiterV1MaterialResolver(rpc).resolve(material.execution.payer, material.execution.quoteResponse, material.execution.rawBuildResponse, material.execution.maximumNativeExpenseLamports, material.execution.quoteRpcLifetime, routeConfigForMaterial(material.execution).routeId);
    // A routine upgrade by the pinned authority between quote and consent is accepted: the simulation below runs against the
    // program as deployed now. The program identities and authorities must stay those the quote was built with.
    if (fresh.transactionBase64 !== material.execution.transactionBase64 || fresh.messageHash !== material.execution.messageHash ||
        fresh.lookupBindingDigest !== material.execution.lookupBindingDigest || canonicalJson(programIdentities(fresh)) !== canonicalJson(programIdentities(material.execution)))
        blocked("Jupiter's frozen message, lookup or program authority changed.");
    const guarded = await guardJupiterV1WhirlpoolMaterial(fresh, { now: clock.now().getTime(), deadline: op.quote.expiresAt }), simulation = await proveJupiterV1Simulation(rpc, guarded);
    return detached({ operationId: op.operationId, materialDigest: material.execution.materialDigest, fresh, simulation });
}
function programIdentities(m) { return m.programPins.map(({ programId, loader, programDataAddress, upgradeAuthority }) => ({ programId, loader, programDataAddress, upgradeAuthority })); }
export class JupiterV1ExecutionDriver {
    d;
    constructor(d) {
        this.d = d;
        JupiterV1LocalSigner.assertGenuine(d.native, d.core.operations.root);
    }
    async execute(input) {
        const op = detached(input.operation), material = detached(validateJupiterV1PreparedMaterial(input.material));
        if (op.state !== "reserved" || op.submissionMarker !== null || !this.d.native.hasForegroundGrant(op))
            blocked("A fresh genuine TTY grant is required before Jupiter's first effect marker.");
        const admission = await this.d.admission.assert(op, material);
        await this.d.bindings.assertPrepared(op, admission, material);
        // The executable bytes and the exact-message simulation were proved before the prompt; only their use remains here.
        const proved = this.d.preconsent.get(op.operationId);
        this.d.preconsent.delete(op.operationId);
        if (proved === undefined || proved.materialDigest !== material.execution.materialDigest)
            blocked("Jupiter's pre-consent executable and simulation proof is missing; approve again in this terminal.");
        const { fresh, simulation } = proved;
        const height = rpcAtomic(await this.d.rpc.call("getBlockHeight", [{ commitment: "confirmed" }]));
        if (height > BigInt(fresh.lifetime.lastValidBlockHeight))
            blocked("Jupiter's frozen blockhash expired before signing.");
        // Leave a bounded reserve for custody, final ownership checks, paced send and preflight.
        // This refuses before any marker or signature; it never replaces the frozen lifetime.
        if (BigInt(fresh.lifetime.lastValidBlockHeight) - height < 24n)
            throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter's frozen blockhash has insufficient reserve before signing.", { remainingBlocksAtomic: (BigInt(fresh.lifetime.lastValidBlockHeight) - height).toString(), minimumRemainingBlocksAtomic: "24" });
        const currentAdmission = await this.d.admission.assert(op, material);
        if (canonicalJson(currentAdmission) !== canonicalJson(admission))
            blocked("Jupiter's owner or active policy changed after simulation.");
        let signed = false;
        const marked = await this.d.core.operations.withLocks([`jupiter-v1-operation:${op.operationId}`], async () => {
            const current = await this.d.core.operations.loadAny(op.operationId);
            if (current === null)
                corrupt();
            if (current.submissionMarker !== null)
                return current;
            if (current.integrityHash !== op.integrityHash)
                blocked("Jupiter's operation changed concurrently.");
            const checkedAt = this.d.clock.now();
            if (checkedAt.toISOString() >= op.quote.expiresAt)
                blocked("Jupiter's approval expired before its effect marker.");
            const marked = await this.d.core.markSubmitting(current, checkedAt);
            try {
                const binding = createJupiterV1ExecutionBinding(marked, material, currentAdmission, simulation, checkedAt, fresh);
                await this.d.bindings.saveFresh(marked, fresh, simulation);
                await this.d.bindings.save(marked, binding, material);
                await this.d.native.sign(marked, binding, material, currentAdmission);
                signed = true;
                return marked;
            }
            catch (error) {
                try {
                    await new JupiterV1ExecutionFailureStore(this.d.core.operations.root).save(marked, "binding_and_sign", error, fresh.lifetime.lastValidBlockHeight, null, this.d.clock.now());
                }
                catch { /* Diagnostic failure never grants a retry of this marked operation. */ }
                return await this.d.core.recordPossibleSend(marked, "unknown_finality", this.d.clock.now());
            }
        });
        if (!signed)
            return marked;
        let result;
        try {
            result = await this.d.sender.sendOnce(marked.operationId);
        }
        catch {
            return await this.observe({ ...input, operation: marked });
        }
        return await this.observe({ ...input, operation: result });
    }
    async observe(input) {
        return await this.d.core.operations.withLocks([`jupiter-v1-operation:${input.operation.operationId}`], async () => {
            let op = await this.d.core.operations.loadAny(input.operation.operationId);
            if (op === null)
                corrupt();
            if (op.submissionMarker === null)
                blocked("Jupiter observation requires its durable effect marker.");
            if (["finalized", "failed_confirmed_revert", "expired_unlanded", "abandoned_unknown"].includes(op.state))
                return op;
            if (op.state === "submitting")
                op = await this.d.core.recordPossibleSend(op, "unknown_finality", this.d.clock.now());
            const material = validateJupiterV1PreparedMaterial(input.material), binding = await this.d.bindings.load(op, material);
            if (binding === null)
                return op;
            // Read the public signature marker first. Status never decrypts custody and never signs or sends.
            const signature = await this.d.bindings.loadSignature(op, binding);
            if (signature === null)
                return op;
            const claim = await this.d.bindings.loadClaim(op);
            if (claim !== null && claim.signature !== signature)
                corrupt();
            const { fresh } = await this.d.bindings.loadFresh(op, binding), guarded = await guardReceipt(fresh);
            // Only the chain answer may leave the operation pending: no finalized status yet, or a failed or refused read.
            let receipt;
            try {
                receipt = await validateFinalizedJupiterV1Receipt(this.d.rpc, guarded, { signature });
            }
            catch {
                return op;
            }
            // A finalized receipt is always recorded. One clock read is both the transition instant and the proof's observedAt:
            // two reads could straddle a millisecond and fail the receipt time binding (observedAt after the transition).
            const at = this.d.clock.now();
            return await this.d.core.finalize(op, at, { receiptHash: receipt.receiptHash, transactionHash: receipt.signature, observedAt: at.toISOString(), finalized: true });
        });
    }
    async proveUnlanded(input) { return await proveJupiterV1Unlanded(this.d, input); }
}
/** Under the operation lock that marking, signing and the single send hold: the frozen lifetime passed at finality and
 * the persisted signature, if any, has no status. Nothing is decrypted, signed or sent. */
export async function proveJupiterV1Unlanded(d, input) {
    return await d.core.operations.withLocks([`jupiter-v1-operation:${input.operation.operationId}`], async () => {
        const op = await d.core.operations.loadAny(input.operation.operationId);
        if (op === null)
            corrupt();
        if (op.submissionMarker === null || op.receiptProof !== null || !["submitting", "submitted", "unknown_finality"].includes(op.state))
            return null;
        const material = validateJupiterV1PreparedMaterial(input.material);
        return await proveSolanaUnlanded(d.rpc, { lastValidBlockHeight: material.execution.lifetime.lastValidBlockHeight, loadSignature: async () => {
                const binding = await d.bindings.load(op, material);
                return binding === null ? null : await d.bindings.loadSignature(op, binding);
            } });
    });
}
async function guardReceipt(fresh) {
    return await guardJupiterV1WhirlpoolMaterial(fresh);
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "jupiter_v1_execution_boundary" }); }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Jupiter V1 execution evidence is missing or changed."); }
/**
 * The Jupiter rail transport: the configured Solana RPC with its per-command physical budget (solanaSwapCommandRequests)
 * and persistent provider pacing. No read budget is stored or carried across commands (SWAP-19), so retrying a command
 * after a rate limit never exhausts an operation. A height read uses a one-element batch: PublicNode returns another
 * shape for the scalar call.
 */
export class JupiterV1BudgetedRpc extends SolanaRpc {
    base;
    originHash;
    budget;
    constructor(base) {
        super();
        this.base = base;
        this.originHash = base.originHash;
        this.budget = base.budget;
    }
    get hasPersistentPacer() { return this.base.hasPersistentPacer; }
    async call(method, params) {
        if (method === "getBlockHeight" && typeof this.base.batch === "function") {
            const results = await this.base.batch([{ method, params }]);
            if (!Array.isArray(results) || results.length !== 1)
                throw new ApnError("APN_RPC_PROTOCOL", "Jupiter height batch is incomplete.");
            return results[0];
        }
        return await this.base.call(method, params);
    }
    async batch(reads) { return await this.base.batch(reads); }
    async sendTransactionAtStart(params, beforeStart) { return await this.base.sendTransactionAtStart(params, beforeStart); }
}
//# sourceMappingURL=v1-execution.js.map