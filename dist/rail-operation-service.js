import { canonicalJson, hashObject } from "./canonical.js";
import { chainAsset, chainDecimal } from "./chain-policy.js";
import { ChainPolicyService } from "./chain-policy-service.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { newRailOperation, publicRailOperation, validateRailPrepared } from "./rail-operation-model.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { railSendReason } from "./rail-send-binding.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { DirectAllowlistGate, refuse } from "./direct-allowlist-gate.js";
import { railAllowlistSubject, requireListedRailAsset } from "./rail-direct-allowlist.js";
import { RailPrepareClaimStore, RailApprovalClaimStore, sealPrepareClaim, sealApprovalClaim } from "./rail-operation-claims.js";
import { RailOperationLifecycle, binding } from "./rail-operation-lifecycle.js";
export class RailOperationService {
    context;
    records;
    policies;
    operations;
    allowlist;
    lifecycle;
    constructor(context) {
        this.context = context;
        this.allowlist = new DirectAllowlistGate(context);
        this.records = new RailOperationRepository(context.state.root);
        this.policies = new ChainPolicyService(context);
        this.operations = new OperationService(context.state, context.providerX402Repository, this.records);
        this.lifecycle = new RailOperationLifecycle({ context, records: this.records, policies: this.policies,
            operations: this.operations, allowlist: this.allowlist });
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile);
        const asset = chainAsset(input.rail, input.asset);
        requireListedRailAsset(asset);
        const amountAtomic = chainDecimal(input.amount, asset.decimals);
        const maximumFeeAtomic = chainDecimal(input.maximumFee, input.rail === "solana" ? 9 : 6);
        const key = canonicalIdempotencyKey(input.idempotencyKey);
        const state = this.context.state;
        const profileHash = state.profileHash(profile);
        const operationId = state.operationId(profile, key);
        const idempotencyHash = state.idempotencyHash(key);
        await this.context.ready();
        if (input.rail === "solana" && (await this.policies.account(profile, "solana")).provider === "local") {
            return await this.prepareLocalSolana(input, { profile, asset, amountAtomic, maximumFeeAtomic, profileHash, operationId, idempotencyHash });
        }
        return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
            const account = await this.policies.account(profile, input.rail);
            const adapter = this.policies.adapter(input.rail, account.provider);
            const recipient = adapter.canonicalAddress(input.recipient);
            if (recipient === account.address)
                throw new ApnError("APN_INVALID_INPUT", "The recipient must differ from the sender for a direct rail transfer.");
            const requestHash = hashObject({ kind: "rail_transfer", account, asset, recipient, amountAtomic, maximumFeeAtomic });
            const existing = await this.operations.resolvePrepare({ kind: "rail_transfer", profileHash, operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "rail_transfer")
                    corrupt();
                return publicRailOperation(existing.record);
            }
            await this.operations.assertRailAccountAvailable(profileHash, account.rail, account.address);
            const policy = await this.policies.authorize(account, input.asset, maximumFeeAtomic);
            // Owner amount caps: the active allowlist policy and the shared usage ledger, checked before any RPC call.
            const allowlist = await this.allowlist.admit(railAllowlistSubject({ profile, operationId, account, prepared: { asset, amountAtomic } }));
            const prepared = await adapter.prepare({ account, asset, recipient, amountAtomic, maximumFeeAtomic, now: this.context.clock.now() });
            validateRailPrepared(prepared, account);
            if (prepared.recipient !== recipient || prepared.amountAtomic !== amountAtomic || prepared.maximumFeeAtomic !== maximumFeeAtomic || canonicalJson(prepared.asset) !== canonicalJson(asset) || prepared.networkIdentity !== policy.networkIdentity)
                corrupt();
            const operation = newRailOperation({ schemaVersion: "apn.rail-operation.v1", kind: "rail_transfer", operationId,
                profile, profileHash, idempotencyHash, requestHash, account, prepared, policyHash: policy.policyHash, allowlist });
            await this.records.persist(operation);
            return publicRailOperation(operation);
        });
    }
    /** A durable, key-scoped claim survives a crash; only its short commit phases hold money-operation locks. */
    async prepareLocalSolana(input, values) {
        const { profile, asset, amountAtomic, maximumFeeAtomic, profileHash, operationId, idempotencyHash } = values;
        const state = this.context.state;
        const locks = [`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`];
        const claims = new RailPrepareClaimStore(state.root);
        // The per-key claim lock serializes duplicate prepares without holding a profile, operation,
        // or idempotency lock through an RPC cooldown. A crashed process releases this advisory lock.
        return await state.withLocks([`rail:prepare-claim:${idempotencyHash}`], async () => {
            const staged = await state.withLocks(locks, async () => {
                const account = await this.policies.account(profile, "solana");
                if (account.provider !== "local")
                    throw new ApnError("APN_PROFILE_DRIFT", "The Solana execution owner changed during preparation.");
                const adapter = this.policies.adapter("solana", account.provider);
                const recipient = adapter.canonicalAddress(input.recipient);
                if (recipient === account.address)
                    throw new ApnError("APN_INVALID_INPUT", "The recipient must differ from the sender for a direct rail transfer.");
                const inputHash = hashObject({ kind: "rail_transfer", profile, rail: "solana", asset, recipient, amountAtomic, maximumFeeAtomic });
                const requestHash = hashObject({ kind: "rail_transfer", account, asset, recipient, amountAtomic, maximumFeeAtomic });
                // A different operation kind may have committed this idempotency key while a crashed
                // Solana prepare left its claim behind. The operation is authoritative, but a claim
                // belonging to another profile must never be removed by this caller.
                const persisted = await this.operations.findIdempotency(idempotencyHash);
                if (persisted !== null) {
                    const stale = await claims.load(idempotencyHash);
                    if (stale?.profileHash === profileHash && stale.operationId === operationId &&
                        persisted.record.idempotencyHash === stale.idempotencyHash)
                        await claims.removeIfMatches(stale);
                    const existing = await this.operations.resolvePrepare({ kind: "rail_transfer", profileHash, operationId, idempotencyHash, requestHash });
                    if (existing === null)
                        corrupt();
                    if (existing.kind !== "rail_transfer")
                        corrupt();
                    return { existing: publicRailOperation(existing.record) };
                }
                const saved = await claims.load(idempotencyHash);
                if (saved !== null && (saved.profileHash !== profileHash || saved.operationId !== operationId)) {
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key already has a pending preparation for another profile.");
                }
                if (saved !== null && saved.inputHash !== inputHash) {
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key already has a pending preparation with different inputs.");
                }
                if (saved !== null && (saved.accountIdentityHash !== account.identityHash || saved.requestHash !== requestHash)) {
                    await claims.removeIfMatches(saved);
                    throw new ApnError("APN_PROFILE_DRIFT", "The pending Solana preparation's account changed; start a new preparation.");
                }
                let policy;
                let allowlist;
                try {
                    await this.operations.assertRailAccountAvailable(profileHash, account.rail, account.address);
                    policy = await this.policies.authorize(account, input.asset, maximumFeeAtomic);
                    allowlist = await this.allowlist.admit(railAllowlistSubject({ profile, operationId, account, prepared: { asset, amountAtomic } }));
                }
                catch (error) {
                    if (saved !== null)
                        await claims.removeIfMatches(saved);
                    throw error;
                }
                const candidate = { schemaVersion: "apn.rail-prepare-claim.v1", profileHash, operationId,
                    idempotencyHash, inputHash, requestHash, accountIdentityHash: account.identityHash, policyHash: policy.policyHash, allowlist };
                if (saved !== null && (saved.policyHash !== policy.policyHash ||
                    canonicalJson(saved.allowlist) !== canonicalJson(allowlist))) {
                    await claims.removeIfMatches(saved);
                    throw new ApnError("APN_PROFILE_DRIFT", "The pending Solana preparation's owner or policy changed; start a new preparation.");
                }
                const claim = saved ?? sealPrepareClaim(candidate);
                if (saved === null)
                    await claims.create(claim);
                return { account, adapter, recipient, requestHash, policy, allowlist, claim };
            });
            if ("existing" in staged)
                return staged.existing;
            const { account, adapter, recipient, requestHash, policy, allowlist, claim } = staged;
            try {
                const prepared = await adapter.prepare({ account, asset, recipient, amountAtomic, maximumFeeAtomic, now: this.context.clock.now() });
                validateRailPrepared(prepared, account);
                if (prepared.recipient !== recipient || prepared.amountAtomic !== amountAtomic || prepared.maximumFeeAtomic !== maximumFeeAtomic ||
                    canonicalJson(prepared.asset) !== canonicalJson(asset) || prepared.networkIdentity !== policy.networkIdentity)
                    corrupt();
                return await state.withLocks(locks, async () => {
                    const existing = await this.operations.resolvePrepare({ kind: "rail_transfer", profileHash, operationId, idempotencyHash, requestHash });
                    if (existing !== null) {
                        if (existing.kind !== "rail_transfer")
                            corrupt();
                        await claims.removeIfMatches(claim);
                        return publicRailOperation(existing.record);
                    }
                    const currentClaim = await claims.load(idempotencyHash);
                    if (currentClaim?.integrityHash !== claim.integrityHash)
                        corrupt();
                    const currentAccount = await this.policies.account(profile, "solana");
                    if (canonicalJson(currentAccount) !== canonicalJson(account))
                        throw new ApnError("APN_PROFILE_DRIFT", "The Solana account changed during preparation.");
                    await this.operations.assertRailAccountAvailable(profileHash, account.rail, account.address);
                    const currentPolicy = await this.policies.authorize(currentAccount, input.asset, maximumFeeAtomic);
                    if (currentPolicy.policyHash !== policy.policyHash)
                        throw new ApnError("APN_PROFILE_DRIFT", "The Solana chain policy changed during preparation.");
                    const currentAllowlist = await this.allowlist.admit(railAllowlistSubject({ profile, operationId, account: currentAccount, prepared: { asset, amountAtomic } }));
                    if (canonicalJson(currentAllowlist) !== canonicalJson(allowlist))
                        throw new ApnError("APN_PROFILE_DRIFT", "The owner allowlist changed during preparation.");
                    if (await this.records.loadOperation(profileHash, operationId) !== null)
                        corrupt();
                    const operation = newRailOperation({ schemaVersion: "apn.rail-operation.v1", kind: "rail_transfer", operationId,
                        profile, profileHash, idempotencyHash, requestHash, account, prepared, policyHash: policy.policyHash, allowlist });
                    await this.records.persist(operation);
                    await claims.removeIfMatches(claim);
                    return publicRailOperation(operation);
                });
            }
            catch (error) {
                // An incomplete RPC read has no effect and no operation. An actual process crash leaves
                // the claim for the next same-key caller, which reacquires this claim lock and retries.
                await state.withLocks(locks, async () => { await claims.removeIfMatches(claim); });
                throw error;
            }
        }, { waitMs: 300_000 });
    }
    async approve(operationId) {
        const found = await this.lifecycle.required(canonicalOperationId(operationId));
        if (found.account.rail === "solana" && found.account.provider === "local" && found.allowlist !== undefined) {
            return await this.approveLocalSolana(found.operationId, found.profileHash);
        }
        return await this.locked(operationId, async (operation) => {
            if (operation.terminal)
                return operation;
            if (operation.state !== "awaiting_approval")
                throw new ApnError("APN_OPERATION_BLOCKED", "The operation has already entered execution; use operation resume.");
            const approval = this.context.railApproval;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-rail approval.");
            const adapter = this.lifecycle.adapter(operation);
            try {
                // A record prepared before the owner allowlist gate is refused before the owner is asked to approve it.
                if (operation.allowlist === undefined)
                    refuse("allowlist_binding_missing", "This transfer was prepared before the owner allowlist gate; prepare a new transfer.");
                await this.lifecycle.revalidate(operation, adapter);
                await approval.approve({ account: operation.account, operationId: operation.operationId, fingerprint: operation.fingerprint, policyHash: operation.policyHash,
                    prepared: operation.prepared, allowlist: operation.allowlist });
                await this.lifecycle.revalidate(operation, adapter);
            }
            catch (error) {
                await this.lifecycle.move(operation, "failed_before_effect", "approval_or_pre_effect_validation_refused", "durable_pre_effect");
                throw error;
            }
            if (adapter.execution === "provider_atomic")
                return await this.lifecycle.submit(operation, adapter, null, await this.lifecycle.reserveUsage(operation));
            let send;
            if (adapter.bindSend !== undefined) {
                try {
                    send = await this.lifecycle.patientBind(operation, adapter.bindSend.bind(adapter));
                }
                catch (error) {
                    await this.lifecycle.move(operation, "failed_before_effect", railSendReason(error, "pre_send_guard_refused"), "durable_pre_effect");
                    throw error;
                }
            }
            const allowlistLease = await this.lifecycle.reserveUsage(operation);
            operation = await this.lifecycle.move(operation, "signing_started", "foreground_signing_started", "durable_pre_effect", undefined, send, allowlistLease);
            return await this.lifecycle.finishLocalApproval(operation, adapter);
        });
    }
    /** The owner prompt and send-window reads run under a durable claim, outside money-operation locks. */
    async approveLocalSolana(operationId, profileHash) {
        const state = this.context.state;
        const keys = [`profile:${profileHash}`, `operation:${operationId}`];
        const claims = new RailApprovalClaimStore(state.root);
        return await state.withLocks([`rail:approval-claim:${operationId}`], async () => {
            const staged = await state.withLocks(keys, async () => {
                const operation = await this.lifecycle.required(operationId);
                await this.records.repairReceipt(operation);
                await this.lifecycle.followUsage(operation);
                const saved = await claims.load(operationId);
                if (operation.terminal) {
                    if (saved?.profileHash === profileHash)
                        await claims.removeIfMatches(saved);
                    return { done: publicRailOperation(operation) };
                }
                if (operation.state !== "awaiting_approval") {
                    if (saved?.profileHash === profileHash)
                        await claims.removeIfMatches(saved);
                    throw new ApnError("APN_OPERATION_BLOCKED", "The operation has already entered execution; use operation resume.");
                }
                if (this.context.railApproval === undefined)
                    throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-rail approval.");
                if (operation.allowlist === undefined)
                    corrupt();
                if (saved !== null && (saved.profileHash !== profileHash || saved.operationIntegrityHash !== operation.integrityHash ||
                    saved.fingerprint !== operation.fingerprint || saved.accountIdentityHash !== operation.account.identityHash ||
                    saved.policyHash !== operation.policyHash || canonicalJson(saved.allowlist) !== canonicalJson(operation.allowlist))) {
                    if (saved.profileHash === profileHash)
                        await claims.removeIfMatches(saved);
                    throw new ApnError("APN_PROFILE_DRIFT", "The pending Solana approval claim no longer matches its operation.");
                }
                const claim = saved ?? sealApprovalClaim({ schemaVersion: "apn.rail-approval-claim.v1", profileHash, operationId,
                    operationIntegrityHash: operation.integrityHash, fingerprint: operation.fingerprint,
                    accountIdentityHash: operation.account.identityHash, policyHash: operation.policyHash, allowlist: operation.allowlist });
                if (saved === null)
                    await claims.create(claim);
                return { operation, claim };
            });
            if ("done" in staged)
                return staged.done;
            const { operation, claim } = staged;
            const adapter = this.lifecycle.adapter(operation);
            const approval = this.context.railApproval;
            try {
                await this.lifecycle.revalidate(operation, adapter);
                await approval.approve({ account: operation.account, operationId, fingerprint: operation.fingerprint, policyHash: operation.policyHash,
                    prepared: operation.prepared, allowlist: claim.allowlist });
                await this.lifecycle.revalidate(operation, adapter);
            }
            catch (error) {
                await this.failApprovalClaim(operation, claim, claims, "approval_or_pre_effect_validation_refused");
                throw error;
            }
            let send;
            if (adapter.bindSend !== undefined) {
                try {
                    send = await this.lifecycle.patientBind(operation, adapter.bindSend.bind(adapter));
                }
                catch (error) {
                    await this.failApprovalClaim(operation, claim, claims, railSendReason(error, "pre_send_guard_refused"));
                    throw error;
                }
            }
            try {
                const committed = await state.withLocks(keys, async () => {
                    const latest = await this.lifecycle.required(operationId);
                    await this.records.repairReceipt(latest);
                    await this.lifecycle.followUsage(latest);
                    const saved = await claims.load(operationId);
                    if (latest.integrityHash !== operation.integrityHash || saved?.integrityHash !== claim.integrityHash) {
                        if (saved?.integrityHash === claim.integrityHash)
                            await claims.removeIfMatches(claim);
                        return { done: publicRailOperation(latest) };
                    }
                    const currentAccount = await this.policies.account(latest.profile, latest.account.rail);
                    if (canonicalJson(currentAccount) !== canonicalJson(latest.account))
                        throw new ApnError("APN_PROFILE_DRIFT", "The Solana account changed during approval.");
                    const policy = await this.policies.authorize(currentAccount, latest.prepared.asset.alias, latest.prepared.maximumFeeAtomic);
                    if (policy.policyHash !== latest.policyHash)
                        throw new ApnError("APN_PROFILE_DRIFT", "The Solana policy changed during approval.");
                    await this.allowlist.confirm(railAllowlistSubject(latest), claim.allowlist);
                    if (this.context.clock.now().getTime() >= Date.parse(latest.prepared.expiresAt))
                        throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen direct-rail approval expired.");
                    const allowlistLease = await this.lifecycle.reserveUsage(latest);
                    const started = await this.lifecycle.move(latest, "signing_started", "foreground_signing_started", "durable_pre_effect", undefined, send, allowlistLease);
                    await claims.removeIfMatches(claim);
                    return { started };
                });
                if ("done" in committed)
                    return committed.done;
                return await this.lifecycle.executeLocalSolanaClaimed(committed.started, adapter, true);
            }
            catch (error) {
                await state.withLocks(keys, async () => { await claims.removeIfMatches(claim); });
                throw error;
            }
        }, { waitMs: 300_000 });
    }
    async failApprovalClaim(operation, claim, claims, reason) {
        await this.context.state.withLocks([`profile:${operation.profileHash}`, `operation:${operation.operationId}`], async () => {
            const latest = await this.lifecycle.required(operation.operationId);
            const saved = await claims.load(operation.operationId);
            if (saved?.integrityHash !== claim.integrityHash)
                return;
            if (latest.integrityHash === operation.integrityHash && latest.state === "awaiting_approval") {
                await this.lifecycle.move(latest, "failed_before_effect", reason, "durable_pre_effect");
            }
            await claims.removeIfMatches(claim);
        });
    }
    async resume(operationId) {
        const found = await this.lifecycle.required(canonicalOperationId(operationId));
        if (found.account.rail === "solana" && found.account.provider === "local")
            return await this.resumeLocalSolana(found.operationId, found.profileHash);
        return await this.locked(operationId, async (operation) => {
            if (operation.terminal || operation.state === "awaiting_approval")
                return operation;
            const adapter = this.lifecycle.adapter(operation);
            if (operation.state === "signing_started" || operation.state === "signed_not_submitted") {
                const effect = await adapter.recoverEffect(binding(operation));
                if (effect === null) {
                    if (operation.state !== "signing_started")
                        corrupt();
                    return await this.lifecycle.move(operation, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
                }
                this.lifecycle.assertEffect(operation, effect);
                if (operation.state === "signing_started")
                    operation = await this.lifecycle.move(operation, "signed_not_submitted", "encrypted_effect_recovered", "durable_signed_effect", effect);
                return await this.lifecycle.firstLocalSubmit(operation, adapter, effect);
            }
            if (operation.state === "submitting")
                operation = await this.lifecycle.move(operation, "unknown_finality", "interrupted_submission_observation_only", "effect_outcome_unknown");
            return await this.lifecycle.inspect(operation, adapter);
        });
    }
    /** Observe an already bound local SOL effect without holding the profile lock during RPC pacing. */
    async resumeLocalSolana(operationId, profileHash) {
        return await this.lifecycle.resumeLocalSolanaPhase(operationId, profileHash, false);
    }
    async receipt(operationId) {
        const found = await this.lifecycle.required(operationId);
        return await this.records.loadReceipt(found.profileHash, found.operationId);
    }
    async locked(operationIdInput, action) {
        const operationId = canonicalOperationId(operationIdInput);
        const found = await this.lifecycle.required(operationId);
        return await this.context.state.withLocks([`profile:${found.profileHash}`, `operation:${operationId}`], async () => {
            const operation = await this.lifecycle.required(operationId);
            await this.records.repairReceipt(operation);
            await this.lifecycle.followUsage(operation);
            return publicRailOperation(await action(operation));
        });
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail effect or operation binding is invalid."); }
//# sourceMappingURL=rail-operation-service.js.map