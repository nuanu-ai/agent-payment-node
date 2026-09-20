import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { BridgeExecution } from "./execution.js";
import { bridgeInventory } from "./catalog.js";
import { BridgeOperationRepository } from "./operation-repository.js";
import { BridgePreparation } from "./prepare.js";
import { BridgeQuoteRepository } from "./quote-repository.js";
import { publicBridgeOperation } from "./receipt.js";
import { transitionBridge } from "./transitions.js";
import { bridgeFailure } from "./validation.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "./allowlist.js";
export class BridgeService {
    context;
    records;
    operations;
    constructor(context) {
        this.context = context;
        this.records = new BridgeOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, undefined, this.records);
    }
    async inventory() { return bridgeInventory(await this.dependencies().provider.inventory()); }
    async routes(profile, request) {
        return await this.preparation().routes(profile, request);
    }
    async prepare(input) {
        return publicBridgeOperation(await this.preparation().prepare(input));
    }
    async approve(operationId) {
        return await this.locked(operationId, async (op) => {
            if (op.terminal || op.state !== "awaiting_approval")
                return publicBridgeOperation(op);
            const approval = this.dependencies().approval;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this bridge intent in a foreground terminal.", {
                    nextActions: [`apn bridge approve --operation ${op.operationId}`],
                });
            return publicBridgeOperation(await this.execution(op).approve(op, approval));
        });
    }
    async resume(operationId) {
        return await this.locked(operationId, async (op) => publicBridgeOperation(op.terminal || op.state === "awaiting_approval" ? op : await this.execution(op).run(op)));
    }
    async status(operationId) { return await this.locked(operationId, async (op) => publicBridgeOperation(op)); }
    async receipt(operationId) {
        return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
    }
    dependencies() {
        if (this.context.bridge === undefined)
            bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "bridge_runtime_unavailable");
        return this.context.bridge;
    }
    preparation() {
        const d = this.dependencies();
        return new BridgePreparation({ state: this.context.state, records: this.records, quotes: new BridgeQuoteRepository(this.context.state.root),
            operations: this.operations, provider: d.provider, rpcFor: d.rpcFor, now: () => this.context.clock.now().getTime() });
    }
    execution(op) {
        const d = this.dependencies(), m = op.intent.materialization;
        return new BridgeExecution(this.context.state, d.rpcFor(m.request.fromChainId), d.rpcFor(m.request.toChainId), d.provider, d.custody, () => this.context.clock.now().getTime(), async (previous, patch) => await this.save(previous, patch));
    }
    async save(op, patch) {
        const next = transitionBridge(op, patch, this.context.clock.now().toISOString());
        await this.records.persist(next);
        await this.followUsage(next);
        return next;
    }
    async followUsage(op) {
        await new BridgeAllowlistGate(this.context).follow(op, bridgeUsageTarget(op));
    }
    async locked(input, work) {
        const operationId = canonicalOperationId(input), first = await this.operations.required(operationId);
        if (first.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "operation_is_not_bridge");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${operationId}`], async () => {
            const current = await this.operations.required(operationId);
            if (current.kind !== "bridge_route")
                bridgeFailure("APN_STATE_CORRUPT", "bridge_operation_kind_changed");
            await this.records.repairReceipt(current.record);
            await this.followUsage(current.record);
            return await work(current.record);
        });
    }
}
//# sourceMappingURL=service.js.map