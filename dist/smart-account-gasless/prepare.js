import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { saPolicyHash } from "./integrity.js";
import { SA_MIN_REMAINING_MS, SA_TTL_MS } from "./model.js";
import { saRequestHash } from "./operation-model.js";
import { assertSmartAccountGaslessBinding, smartAccountGaslessOwner } from "./owner.js";
import { SmartAccountGaslessClock, smartAccountGaslessSnapshot } from "./policy.js";
import { saRegistry } from "./registry.js";
import { saFail } from "./reasons.js";
import { saProviderBinding, saRequest } from "./schema.js";
import { newSmartAccountGaslessOperation } from "./transitions.js";
export class SmartAccountGaslessPreparation {
    o;
    constructor(o) {
        this.o = o;
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), request = saRequest(input.request), key = canonicalIdempotencyKey(input.idempotencyKey);
        const state = this.o.state, profileHash = state.profileHash(profile), operationId = state.operationId(profile, key);
        const idempotencyHash = state.idempotencyHash(key), registry = saRegistry(request.chainId);
        const requestHash = saRequestHash(profileHash, { request, token: registry.token.address });
        return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
            const existing = await this.o.operations.resolvePrepare({ kind: "smart_account_gasless_transfer", profileHash,
                operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "smart_account_gasless_transfer")
                    saFail("sa_gasless_state_corrupt");
                await this.o.records.repairReceipt(existing.record);
                return existing.record;
            }
            const clock = new SmartAccountGaslessClock(this.o.clock);
            clock.check();
            const owner = await smartAccountGaslessOwner(state, profile);
            clock.check();
            await this.o.operations.assertEvmAccountAvailable(profileHash, request.chainId, owner.address);
            const binding = assertSmartAccountGaslessBinding(await this.o.material.inspect(owner, Math.floor(clock.check() / 1000)), owner);
            clock.check();
            if (request.recipient === binding.ownerAddress || request.recipient === binding.sessionAddress)
                saFail("sa_gasless_input");
            if (BigInt(binding.rootCapAtomic) < BigInt(request.grossAtomic))
                saFail("sa_gasless_allowance");
            const provider = saProviderBinding(await this.o.provider.supported());
            clock.fresh(provider.observedAt);
            const rpc = this.o.rpcFor(request.chainId);
            if (rpc.chainId !== request.chainId)
                saFail("sa_gasless_rpc_binding");
            const snapshot = smartAccountGaslessSnapshot(await rpc.snapshot(binding), binding, rpc);
            clock.fresh(snapshot.observedAt);
            if (BigInt(snapshot.safeState.usdcBalanceAtomic) < BigInt(request.grossAtomic))
                saFail("sa_gasless_balance");
            if (BigInt(snapshot.safeState.availableAtomic) < BigInt(request.grossAtomic))
                saFail("sa_gasless_allowance");
            const prepared = clock.fresh(provider.observedAt), preparedAt = new Date(prepared).toISOString(), afterUnix = Math.floor(prepared / 1000);
            const beforeUnix = Math.min(afterUnix + SA_TTL_MS / 1000, binding.rootExpiresAtUnix);
            if (beforeUnix * 1000 - prepared < SA_MIN_REMAINING_MS || afterUnix < binding.rootStartsAtUnix)
                saFail("sa_gasless_expired");
            const intent = { profile, request, binding, token: registry.token.address, decimals: 6,
                deploymentEvidenceHash: registry.evidenceHash, provider, initialSnapshot: snapshot, preparedAt,
                expiresAt: new Date(beforeUnix * 1000).toISOString(), afterUnix, beforeUnix, policyHash: saPolicyHash(binding, request),
                requirements: { scheme: "exact", network: "eip155:8453", asset: registry.token.address, amount: request.grossAtomic,
                    payTo: request.recipient, maxTimeoutSeconds: beforeUnix - afterUnix,
                    extra: { assetTransferMethod: "erc7710", facilitatorAddresses: provider.facilitatorAddresses } } };
            const op = newSmartAccountGaslessOperation({ profileHash, operationId, idempotencyHash, requestHash }, intent);
            clock.live(op);
            await this.o.records.persist(op);
            return op;
        });
    }
}
//# sourceMappingURL=prepare.js.map