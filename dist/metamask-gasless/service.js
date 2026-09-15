import { mmObservationRpcEnv } from "./chain/rpc.js";
import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { MetaMaskGaslessClock } from "./clock.js";
import { MetaMaskGaslessExecution } from "./execution.js";
import { MetaMaskGaslessOperationRepository } from "./journal/repository.js";
import { publicMetaMaskGaslessOperation } from "./journal/receipt.js";
import { advanceMetaMaskGaslessOperation } from "./journal/transitions.js";
import { metaMaskGaslessOwner } from "./owner.js";
import { MetaMaskGaslessPreparation } from "./prepare.js";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";
import { mmChain } from "./validation.js";
export class MetaMaskGaslessService {
    context;
    records;
    operations;
    constructor(context) {
        this.context = context;
        this.records = context.metaMaskGasless?.records ?? new MetaMaskGaslessOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, undefined, this.records);
    }
    async balance(profile, chainId) {
        const { row } = mmRegistry(mmChain(chainId)), clock = new MetaMaskGaslessClock(this.context.clock);
        clock.check();
        const owner = await metaMaskGaslessOwner(this.context.state, profile);
        clock.check();
        const rpc = this.dependencies().rpcFor(chainId);
        if (rpc.chainId !== chainId)
            mmFail("mm_gasless_rpc_binding");
        const balance = await rpc.balance(owner.address);
        clock.check(undefined, [balance.observedAt]);
        if (balance.chainId !== chainId || balance.endpointHash !== rpc.endpointHash || balance.endpointOrigin !== rpc.endpointOrigin) {
            mmFail("mm_gasless_rpc_binding");
        }
        return { profile: owner.profile, provider: "metamask-agent-wallet", chain_id: chainId,
            token: row.token, symbol: "USDC", decimals: 6, address: owner.address, balance_atomic: balance.state.usdcBalanceAtomic,
            designation: balance.state.designation, block: balance.block, observed_at: balance.observedAt,
            rpc_origin: balance.endpointOrigin, endpoint_hash: balance.endpointHash,
            sender_native_balance_required: false, proof_class: "chain_verified_public_read" };
    }
    async prepare(input) {
        const d = this.dependencies();
        const preparation = new MetaMaskGaslessPreparation({ state: this.context.state, records: this.records,
            operations: this.operations, rpcFor: d.rpcFor, provider: d.provider, clock: this.context.clock, ids: this.context.ids });
        return publicMetaMaskGaslessOperation(await preparation.prepare(input));
    }
    async approve(operationId) {
        return await this.locked(operationId, async (op) => {
            if (op.terminal || op.state !== "awaiting_approval")
                return publicMetaMaskGaslessOperation(op);
            const approval = this.dependencies().approval;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this MetaMask USDC transfer in a foreground terminal.", {
                    reason: "mm_gasless_approval", nextActions: [`apn gasless transfer approve --operation ${op.operationId}`],
                });
            return this.project(await this.execution().approve(op, approval));
        });
    }
    async resume(operationId, observationRpcEnv) {
        const environmentName = observationRpcEnv === undefined ? undefined : mmObservationRpcEnv(observationRpcEnv);
        return await this.locked(operationId, async (op) => {
            if (op.terminal || op.state === "awaiting_approval")
                return publicMetaMaskGaslessOperation(op);
            if (environmentName === undefined)
                return this.project(await this.execution().run(op));
            const factory = this.dependencies().observationRpcFor;
            if (factory === undefined)
                return mmFail("mm_gasless_rpc_binding");
            return this.project(await this.execution().observeWith(op, { rpc: factory(op.intent.request.chainId, environmentName), environmentName }));
        });
    }
    async status(operationId) {
        return await this.locked(operationId, async (op) => publicMetaMaskGaslessOperation(op));
    }
    async receipt(operationId) {
        return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
    }
    project(step) {
        const result = publicMetaMaskGaslessOperation(step.operation);
        return step.warning === undefined ? result : { ...result, transient_warning: step.warning };
    }
    dependencies() {
        if (this.context.metaMaskGasless === undefined)
            mmFail("mm_gasless_capability_unavailable");
        return this.context.metaMaskGasless;
    }
    execution() {
        const d = this.dependencies();
        return new MetaMaskGaslessExecution(this.context.state, d.rpcFor, d.provider, this.context.clock, async (op, patch, at) => {
            const next = advanceMetaMaskGaslessOperation(op, patch, at);
            await this.records.persist(next);
            return next;
        });
    }
    async locked(input, work) {
        const id = canonicalOperationId(input), first = await this.operations.required(id);
        if (first.kind !== "metamask_gasless_transfer")
            mmFail("mm_gasless_input");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${id}`], async () => {
            const current = await this.operations.required(id);
            if (current.kind !== "metamask_gasless_transfer")
                mmFail("mm_gasless_state_corrupt");
            await this.records.repairReceipt(current.record);
            return await work(current.record);
        });
    }
}
//# sourceMappingURL=service.js.map