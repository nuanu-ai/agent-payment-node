import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { GaslessExecution } from "./execution.js";
import { GaslessAssetPolicy, gaslessPolicyChain } from "./asset-policy.js";
import { GaslessOperationRepository } from "./operation-repository.js";
import { gaslessOwner } from "./owner.js";
import { GaslessObservationService } from "./observation.js";
import { gaslessObservationRpcEnv } from "./observation-source.js";
import { GaslessPreparation } from "./prepare.js";
import { withGaslessRpcInvocation } from "./rpc.js";
import { publicGaslessOperation } from "./receipt.js";
import { gaslessAsset, gaslessDeployment, gaslessIntentAsset } from "./registry.js";
import { snapshotSchema } from "./schema.js";
import { transitionGasless } from "./transitions.js";
import { gaslessFailure } from "./validation.js";
export class GaslessService {
    context;
    records;
    operations;
    policy;
    constructor(context) {
        this.context = context;
        this.records = new GaslessOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, this.records);
        this.policy = new GaslessAssetPolicy(context.state, () => context.clock.now().getTime());
    }
    async balance(profile, chainId) {
        return await withGaslessRpcInvocation(async () => {
            const row = gaslessDeployment(chainId), { owner } = await gaslessOwner(this.context.state, profile);
            const asset = gaslessAsset(chainId, row.token);
            const rpc = this.dependencies().rpcFor(chainId);
            const snapshot = await rpc.snapshot(owner.address);
            if (!snapshotSchema.safeParse(snapshot).success || snapshot.chainId !== chainId || snapshot.owner !== owner.address ||
                snapshot.token !== row.token)
                gaslessFailure("APN_RPC_PROTOCOL", "gasless_balance_binding");
            return { profile: owner.profile, provider: "local", chain_id: chainId, token: row.token, symbol: asset.symbol, decimals: asset.decimals,
                address: owner.address, balance_atomic: snapshot.balanceAtomic, native_balance_wei: snapshot.nativeBalanceWei,
                paymaster_allowance_atomic: snapshot.allowanceAtomic, delegation: snapshot.delegation,
                block: snapshot.block, rpc_origin: snapshot.rpcOrigin, proof_class: "chain_verified_public_read" };
        });
    }
    async prepare(input) {
        return await withGaslessRpcInvocation(async () => {
            const d = this.dependencies();
            const preparation = new GaslessPreparation({ state: this.context.state, records: this.records,
                operations: this.operations, rpcFor: d.rpcFor, now: () => this.context.clock.now().getTime(), policy: this.policy });
            return publicGaslessOperation(await preparation.prepare(input));
        });
    }
    async approve(operationId) {
        return await withGaslessRpcInvocation(async () => await this.locked(operationId, async (op) => {
            if (op.terminal || op.state !== "awaiting_approval")
                return publicGaslessOperation(op);
            if (this.legacyPolicyOperation(op))
                return publicGaslessOperation(await this.save(op, { state: "failed_before_effect", failure: "gasless_legacy_observation_only" }));
            const approval = this.dependencies().approval;
            const unit = gaslessIntentAsset(op.intent).symbol;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", `Approve this ${unit} fee transfer in a foreground terminal.`, {
                    nextActions: [`apn gasless transfer approve --operation ${op.operationId}`],
                });
            return publicGaslessOperation(await this.execution(op).approve(op, approval));
        }));
    }
    async resume(operationId, observationRpcEnv) {
        return await withGaslessRpcInvocation(async () => {
            if (observationRpcEnv !== undefined) {
                const environmentName = gaslessObservationRpcEnv(observationRpcEnv);
                return await this.locked(operationId, async (op) => {
                    if (!op.terminal && this.legacyPolicyOperation(op) && op.bootstrap.signingAttempts === 0) {
                        return publicGaslessOperation(await this.legacyRecovery(op));
                    }
                    if (op.terminal || op.bootstrap.signingAttempts === 0)
                        return publicGaslessOperation(op);
                    const factory = this.dependencies().observationRpcFor;
                    if (factory === undefined)
                        gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_unavailable");
                    const observer = new GaslessObservationService(factory(op.intent.request.chainId, environmentName), async (previous, patch) => await this.save(previous, patch), environmentName);
                    return publicGaslessOperation(await observer.run(op));
                });
            }
            return await this.locked(operationId, async (op) => publicGaslessOperation(op.terminal ? op : this.legacyPolicyOperation(op) ? await this.legacyRecovery(op)
                : op.state === "awaiting_approval" ? op : await this.execution(op).run(op)));
        });
    }
    async status(operationId) { return await this.locked(operationId, async (op) => publicGaslessOperation(op)); }
    async receipt(operationId) {
        return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
    }
    dependencies() {
        if (this.context.gasless === undefined)
            gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_runtime_unavailable");
        return this.context.gasless;
    }
    execution(op) {
        const d = this.dependencies();
        return new GaslessExecution(this.context.state, d.rpcFor(op.intent.request.chainId), d.custody, () => this.context.clock.now().getTime(), async (previous, patch) => await this.save(previous, patch), this.context.wait, this.policy);
    }
    async save(op, patch) {
        const next = transitionGasless(op, patch, this.context.clock.now().toISOString());
        await this.records.persist(next);
        await this.policy.reconcile(next);
        return next;
    }
    legacyPolicyOperation(op) {
        return gaslessPolicyChain(op.intent.request.chainId) !== null && op.intent.allowlist === undefined;
    }
    async legacyRecovery(op) {
        if (op.bootstrap.signingAttempts === 0 && op.userOperation.signingAttempts === 0) {
            return await this.save(op, { state: "failed_before_effect", failure: "gasless_legacy_observation_only" });
        }
        const d = this.dependencies();
        return await new GaslessObservationService(d.rpcFor(op.intent.request.chainId), async (previous, patch) => await this.save(previous, patch)).run(op);
    }
    async locked(input, work) {
        const operationId = canonicalOperationId(input), first = await this.operations.required(operationId);
        if (first.kind !== "gasless_transfer")
            gaslessFailure("APN_OPERATION_BLOCKED", "gasless_operation_kind");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${operationId}`], async () => await this.context.state.withLocks([`profile:${allowlistProfileHash(first.record.intent.profile)}`], async () => {
            const current = await this.operations.required(operationId);
            if (current.kind !== "gasless_transfer")
                gaslessFailure("APN_STATE_CORRUPT", "gasless_operation_kind_changed");
            await this.records.repairReceipt(current.record);
            await this.policy.reconcile(current.record);
            return await work(current.record);
        }));
    }
}
//# sourceMappingURL=service.js.map