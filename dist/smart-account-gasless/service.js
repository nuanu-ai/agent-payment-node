import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { SmartAccountGaslessExecution } from "./execution.js";
import { SmartAccountGaslessOperationRepository } from "./operation-repository.js";
import { assertSmartAccountGaslessBinding, smartAccountGaslessOwner } from "./owner.js";
import { SmartAccountGaslessClock, smartAccountGaslessSnapshot } from "./policy.js";
import { SmartAccountGaslessPreparation } from "./prepare.js";
import { publicSmartAccountGaslessOperation } from "./receipt.js";
import { saRegistry } from "./registry.js";
import { saFail } from "./reasons.js";
import { advanceSmartAccountGaslessOperation } from "./transitions.js";
export class SmartAccountGaslessService {
    context;
    records;
    operations;
    constructor(context) {
        this.context = context;
        this.records = context.smartAccountGasless?.records ?? new SmartAccountGaslessOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, undefined, context.metaMaskGasless?.records, this.records);
    }
    async balance(profile, chainId) {
        const registry = saRegistry(chainId), clock = new SmartAccountGaslessClock(this.context.clock);
        clock.check();
        const d = this.dependencies(), owner = await smartAccountGaslessOwner(this.context.state, profile);
        clock.check();
        const binding = assertSmartAccountGaslessBinding(await d.material.inspect(owner, Math.floor(clock.check() / 1000)), owner);
        clock.check();
        const rpc = d.rpcFor(8453), snapshot = smartAccountGaslessSnapshot(await rpc.snapshot(binding), binding, rpc);
        clock.fresh(snapshot.observedAt);
        return { profile: owner.profile, provider: "metamask-smart-account", chain_id: 8453, token: registry.token.address,
            symbol: "USDC", decimals: 6, owner: binding.ownerAddress, session: binding.sessionAddress,
            balance_atomic: snapshot.safeState.usdcBalanceAtomic, owner_native_balance_wei: snapshot.safeState.ownerNativeBalanceWei,
            session_native_balance_wei: snapshot.safeState.sessionNativeBalanceWei, available_allowance_atomic: snapshot.safeState.availableAtomic,
            root_delegation_hash: binding.rootDelegationHash, root_nonce_atomic: binding.rootNonceAtomic,
            block: snapshot.safeBlock, observed_at: snapshot.observedAt, rpc_origin: snapshot.endpointOrigin,
            endpoint_hash: snapshot.endpointHash, sender_native_balance_required: false, proof_class: "chain_verified_public_read" };
    }
    async prepare(input) {
        const d = this.dependencies();
        return publicSmartAccountGaslessOperation(await new SmartAccountGaslessPreparation({ state: this.context.state,
            records: this.records, operations: this.operations, material: d.material, provider: d.provider,
            rpcFor: d.rpcFor, clock: this.context.clock }).prepare(input));
    }
    async approve(operationId) {
        return await this.locked(operationId, async (op) => {
            if (op.terminal || op.state !== "awaiting_approval")
                return publicSmartAccountGaslessOperation(op);
            const approval = this.dependencies().approval;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this Smart Account USDC transfer in a foreground terminal.", { reason: "sa_gasless_approval", nextActions: [`apn gasless transfer approve --operation ${op.operationId}`] });
            return this.project(await this.execution().approve(op, approval));
        });
    }
    async resume(operationId) {
        return await this.locked(operationId, async (op) => op.terminal || op.state === "awaiting_approval" ?
            publicSmartAccountGaslessOperation(op) : this.project(await this.execution().run(op)));
    }
    async status(operationId) { return await this.locked(operationId, async (op) => publicSmartAccountGaslessOperation(op)); }
    async receipt(operationId) { return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId)); }
    project(step) {
        const result = publicSmartAccountGaslessOperation(step.operation);
        return step.warning === undefined ? result : { ...result, transient_warning: step.warning };
    }
    dependencies() {
        if (this.context.smartAccountGasless === undefined)
            saFail("sa_gasless_capability");
        return this.context.smartAccountGasless;
    }
    execution() {
        const d = this.dependencies();
        return new SmartAccountGaslessExecution(this.context.state, d.rpcFor, d.material, d.provider, this.context.clock, async (op, patch, at) => {
            const next = advanceSmartAccountGaslessOperation(op, patch, at);
            await this.records.persist(next);
            return next;
        });
    }
    async locked(input, work) {
        const id = canonicalOperationId(input), first = await this.operations.required(id);
        if (first.kind !== "smart_account_gasless_transfer")
            saFail("sa_gasless_input");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${id}`], async () => {
            const current = await this.operations.required(id);
            if (current.kind !== "smart_account_gasless_transfer")
                saFail("sa_gasless_state_corrupt");
            await this.records.repairReceipt(current.record);
            return await work(current.record);
        });
    }
}
//# sourceMappingURL=service.js.map