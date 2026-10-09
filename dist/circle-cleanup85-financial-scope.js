import { Cleanup85UnsignedRetirementStore, CLEANUP85_UNSIGNED_ORIGINAL } from "./circle-cleanup85-unsigned-retirement-store.js";
import { walletCustodyLock } from "./encrypted-wallet-store.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { hashObject } from "./canonical.js";
import { allowlistProfileHash } from "./allowlist-policy-overlay.js";
import { evmAddressLock } from "./evm-address-ownership.js";
import { assertEvmNativeCustody } from "./evm-native-custody.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } from "./circle-cleanup85-unsigned-retirement.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { CircleNonceRetirementStore } from "./circle-v2-evm/nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest } from "./circle-v2-evm/cleanup85-recovery-store.js";
const scopes = new WeakMap(), current = new AsyncLocalStorage();
export function assertHeldCleanup85Scope(token, state, request, operationId) {
    const value = scopes.get(token);
    if (value === undefined || !value.active || current.getStore() !== value || value.state !== state || value.requestHash !== hashObject(request) || value.operationId !== operationId)
        cleanup85Blocked("held_financial_scope_required");
}
/** Metadata and locks only. No nonce, policy TTL, reservation or financial authority. */
export async function withCleanup85FinancialScope(state, request, operationId, action) { return withScope(state, request, operationId, action, false); }
export async function withCleanup85UnsignedRetirementScope(state, request, action) { return withScope(state, request, CLEANUP85_UNSIGNED_ORIGINAL, action, true); }
async function withScope(state, request, operationId, action, retirementOnly) {
    if (current.getStore() !== undefined)
        cleanup85Blocked("financial_scope_reentry");
    const repo = new CircleRepository(state.root), parent = await repo.load(request.parentOperationId);
    if (parent === null)
        cleanup85Blocked("financial_scope_parent");
    const old = await new CircleNonceRetirementStore(state.root).intent(parent);
    if (old === null)
        cleanup85Blocked("financial_scope_original_intent");
    const frame = await new Cleanup85RecoveryStore(state.root).load(parent, old);
    if (frame === null || hashObject(cleanup85CancellationRequest(frame)) !== hashObject(request))
        cleanup85Blocked("financial_scope_request");
    const originalNamespace = `cleanup85-native:${request.recoveryBinding}`;
    const lineage = retirementOnly ? { originalOperationId: state.operationId("evm-live-buyer", originalNamespace), operationId: CLEANUP85_UNSIGNED_ORIGINAL, namespace: originalNamespace } : verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state, request), state, request);
    if (retirementOnly) {
        if (lineage.originalOperationId !== CLEANUP85_UNSIGNED_ORIGINAL)
            cleanup85Blocked("retirement_scope_exact_original");
        const p = await new Cleanup85UnsignedRetirementStore(state.root).load();
        if (p !== null)
            await new Cleanup85UnsignedRetirementStore(state.root).verifyRetained(state, p, true);
    }
    if (operationId !== lineage.operationId)
        cleanup85Blocked("financial_scope_operation");
    const profiles = [parent.profile, parent.destinationProfile, "default"], custodies = [parent.sourceCustody, parent.destinationCustody, frame.recipientCustody];
    const locks = [...custodies.map(c => `profile:${c.profileHash}`), `operation:${parent.operationId}`, `operation:${lineage.originalOperationId}`, `operation:${lineage.operationId}`, `operation:idempotency:${parent.idempotencyHash}`, `operation:idempotency:${state.idempotencyHash(`cleanup85-native:${request.recoveryBinding}`)}`, `operation:idempotency:${state.idempotencyHash(lineage.namespace)}`, ...custodies.map(c => evmAddressLock(c.walletAddress))];
    return state.withLocks(profiles.map(p => walletCustodyLock(state, p)), () => state.withLocks(locks, () => state.withLocks(profiles.map(p => `profile:${allowlistProfileHash(p)}`), async () => {
        if ((await repo.load(parent.operationId))?.integrityHash !== parent.integrityHash)
            cleanup85Blocked("financial_scope_parent_changed");
        if (!retirementOnly) {
            const latest = verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state, request), state, request);
            if (hashObject(latest) !== hashObject(lineage))
                cleanup85Blocked("financial_scope_lineage_changed");
        }
        for (let i = 0; i < profiles.length; i++)
            await assertEvmNativeCustody(state, profiles[i], custodies[i]);
        const token = Object.freeze({ kind: "held-cleanup85-financial-scope" }), ctx = { state, requestHash: hashObject(request), operationId, active: true, token };
        scopes.set(token, ctx);
        return current.run(ctx, async () => { try {
            return await action(token);
        }
        finally {
            ctx.active = false;
            scopes.delete(token);
        } });
    })));
}
//# sourceMappingURL=circle-cleanup85-financial-scope.js.map