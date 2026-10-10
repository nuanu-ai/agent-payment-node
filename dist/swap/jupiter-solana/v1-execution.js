import { randomUUID } from "node:crypto";
import { SecureStateStore } from "../../secure-state-store.js";
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
                    this.rpc.budget.maxPhysicalRequests !== 64 || this.rpc.budget.remainingPhysicalRequests < 1 || !this.rpc.hasPersistentPacer)
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
        // Re-resolve the same frozen official build. No new quote, lifetime, transaction, or route bytes are substituted.
        const fresh = await new JupiterV1MaterialResolver(this.d.rpc).resolve(material.execution.payer, material.execution.quoteResponse, material.execution.rawBuildResponse, material.execution.maximumNativeExpenseLamports, material.execution.quoteRpcLifetime, routeConfigForMaterial(material.execution).routeId);
        if (fresh.transactionBase64 !== material.execution.transactionBase64 || fresh.messageHash !== material.execution.messageHash ||
            fresh.lookupBindingDigest !== material.execution.lookupBindingDigest || canonicalJson(fresh.programPins) !== canonicalJson(material.execution.programPins))
            blocked("Jupiter's frozen message, lookup or runtime executable identity changed.");
        const guarded = await guardJupiterV1WhirlpoolMaterial(fresh, { now: this.d.clock.now().getTime(), deadline: op.quote.expiresAt }), simulation = await proveJupiterV1Simulation(this.d.rpc, guarded);
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
            if (["finalized", "failed_confirmed_revert"].includes(op.state))
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
            try {
                const { fresh } = await this.d.bindings.loadFresh(op, binding), guarded = await guardReceipt(fresh);
                const receipt = await validateFinalizedJupiterV1Receipt(this.d.rpc, guarded, { signature });
                return await this.d.core.finalize(op, this.d.clock.now(), { receiptHash: receipt.receiptHash, transactionHash: receipt.signature, observedAt: this.d.clock.now().toISOString(), finalized: true });
            }
            catch {
                return op;
            }
        });
    }
}
async function guardReceipt(fresh) {
    return await guardJupiterV1WhirlpoolMaterial(fresh);
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "jupiter_v1_execution_boundary" }); }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Jupiter V1 execution evidence is missing or changed."); }
/** Counts every logical attempt durably before RPC, including failed reads and the single send. */
class JupiterV1StageBudgetStore extends SecureStateStore {
    readyPromise;
    async ready() { this.readyPromise ??= (async () => { await super.initialize(); await this.ensureDirectory("jupiter-v1-runtime-budgets"); await this.ensureDirectory("jupiter-v1-budget-quotes"); })(); await this.readyPromise; }
    async charge(key, priorQuoteCalls) {
        await this.ready();
        return await this.withLocks([`jupiter-v1-runtime-budget:${key}`], async () => {
            const path = `jupiter-v1-runtime-budgets/${key}.json`, raw = await this.readJson(path);
            let count = 0;
            if (raw !== null) {
                if (!isPlainRecord(raw) || raw.key !== key || raw.priorQuoteCalls !== priorQuoteCalls || typeof raw.calls !== "number")
                    corrupt();
                const { recordHash, ...body } = raw;
                if (recordHash !== domainHash("apn.jupiter-v1-runtime-budget.v1", canonicalJson(body)))
                    corrupt();
                count = raw.calls;
            }
            if (!Number.isSafeInteger(count) || count < 0 || count >= 64 || priorQuoteCalls + count >= 192)
                blocked("Jupiter's trusted runtime stage/cumulative logical RPC cap was exhausted.");
            const body = { schemaVersion: "apn.jupiter-v1-runtime-budget.v1", key, calls: count + 1, priorQuoteCalls, authority: "runtime_cap", stageCap: 64, cumulativeCap: 192 };
            await this.writeJson(path, { ...body, recordHash: domainHash(body.schemaVersion, canonicalJson(body)) });
            return count + 1;
        });
    }
    async bindQuote(hash, calls) {
        await this.ready();
        const body = { quoteHash: hash, calls, authority: "runtime_cap", stageCap: 64 };
        const path = `jupiter-v1-budget-quotes/${hash}.json`, record = { ...body, recordHash: domainHash("apn.jupiter-v1-quote-budget.v1", canonicalJson(body)) }, old = await this.readJson(path);
        if (old !== null) {
            if (canonicalJson(old) !== canonicalJson(record))
                corrupt();
            return;
        }
        await this.writeJson(path, record, true);
    }
    async quoteCalls(hash) {
        await this.ready();
        const raw = await this.readJson(`jupiter-v1-budget-quotes/${hash}.json`);
        if (!isPlainRecord(raw) || raw.quoteHash !== hash || typeof raw.calls !== "number" || !Number.isSafeInteger(raw.calls) || raw.calls < 1 || raw.calls > 64)
            corrupt();
        const { recordHash, ...body } = raw;
        if (recordHash !== domainHash("apn.jupiter-v1-quote-budget.v1", canonicalJson(body)))
            corrupt();
        return raw.calls;
    }
}
/** Owns the actual bounded Solana rail transport; no new URL, fallback or financial callback is accepted. */
export class JupiterV1BudgetedRpc extends SolanaRpc {
    base;
    stage;
    originHash;
    budget;
    journal;
    stageKey;
    calls = 0;
    priorQuoteCalls = 0;
    constructor(base, root, stage, operationId) {
        super();
        this.base = base;
        this.stage = stage;
        this.originHash = base.originHash;
        this.budget = base.budget;
        this.journal = new JupiterV1StageBudgetStore(root);
        this.stageKey = sha256(`jupiter-v1-runtime-stage:${stage}:${stage === "execute" || stage === "observe" ? operationId : randomUUID()}`);
    }
    get hasPersistentPacer() { return this.base.hasPersistentPacer; }
    get maximumAccountsPerRead() { return this.base.maximumAccountsPerRead; }
    async bindOperation(quoteHash) { if (this.stage === "execute")
        this.priorQuoteCalls = await this.journal.quoteCalls(quoteHash); }
    async bindQuote(quoteHash) { if (this.stage !== "quote")
        corrupt(); await this.journal.bindQuote(quoteHash, this.calls); }
    async chargeOfficialRead() { await this.charge(); }
    async charge() { this.calls = await this.journal.charge(this.stageKey, this.priorQuoteCalls); }
    async call(method, params) { await this.charge(); return await this.base.call(method, params); }
    async batch(reads) {
        // Every logical read consumes the durable stage cap before the shared physical POST.
        for (const _read of reads)
            await this.charge();
        return await this.base.batch(reads);
    }
    async sendTransactionAtStart(params, beforeStart) { await this.charge(); return await this.base.sendTransactionAtStart(params, beforeStart); }
}
//# sourceMappingURL=v1-execution.js.map