import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { BridgeExecution } from "./execution.js";
import { bridgeInventory } from "./catalog.js";
import { BridgeOperationRepository } from "./operation-repository.js";
import { BridgePreparation } from "./prepare.js";
import { BridgeQuoteRepository } from "./quote-repository.js";
import { publicBridgeOperation, publicStoredBridgeOperation } from "./receipt.js";
import { transitionBridge } from "./transitions.js";
import { bridgeFailure } from "./validation.js";
import { BridgeAllowlistGate, bridgeUsageTarget } from "./allowlist.js";
import { isLegacyBridgeOperation } from "./legacy-operation.js";
import { LINEA_DEPLOYMENT_MIGRATION_CANDIDATE, assertLineaDeploymentMigrationProof, migrateLineaDeploymentOperation } from "./deployment-migration.js";
import { bridgeProtocolEmitter } from "./deployments.js";
import { BASE_DEPLOYMENT_MIGRATION_CANDIDATE, assertBaseDeploymentMigrationProof, migrateBaseDeploymentOperation } from "./base-deployment-migration.js";
import { RpcReadSession } from "./rpc.js";
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
        return publicStoredBridgeOperation(await this.preparation().prepare(input));
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
    async status(operationId) {
        const found = await this.operations.required(operationId);
        if (found.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "operation_is_not_bridge");
        return publicStoredBridgeOperation(found.record);
    }
    async receipt(operationId) {
        const found = await this.operations.required(operationId);
        if (found.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "operation_is_not_bridge");
        if (isLegacyBridgeOperation(found.record))
            return await this.records.loadLegacyReceipt(found.record);
        return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
    }
    async repairDeployment(operationId) {
        return await this.deploymentMigrationLocked(operationId, async (op) => {
            const raw = isLegacyBridgeOperation(op) ? op.raw : op;
            const session = new RpcReadSession({ now: () => this.context.clock.now().getTime() });
            if (raw.operationId === BASE_DEPLOYMENT_MIGRATION_CANDIDATE.operationId) {
                if (!isLegacyBridgeOperation(op)) {
                    const eligible = migrateBaseDeploymentOperation(raw);
                    await this.records.repairMigratedLegacyDeployment(eligible.previousOperation, eligible.operation, eligible.audit);
                    return migrationProjection(eligible.operation, eligible.audit, true);
                }
                const d = this.context.bridge;
                if (d === undefined)
                    bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "bridge_runtime_unavailable");
                const request = raw.intent.materialization.request, source = d.rpcFor(request.fromChainId, session), destination = d.rpcFor(request.toChainId, session);
                if (source.origin !== BASE_DEPLOYMENT_MIGRATION_CANDIDATE.verifiedSourceDeployment.rpcOrigin ||
                    destination.origin !== BASE_DEPLOYMENT_MIGRATION_CANDIDATE.newDestinationDeployment.rpcOrigin) {
                    bridgeFailure("APN_OPERATION_BLOCKED", "migration_rpc_origin_mismatch");
                }
                const effect = raw.effects.find((entry) => entry.role === "bridge");
                if (effect?.transactionHash !== BASE_DEPLOYMENT_MIGRATION_CANDIDATE.sourceTransactionHash)
                    bridgeFailure("APN_OPERATION_BLOCKED", "migration_source_transaction_missing");
                const [sourceObserved, destinationObserved] = await Promise.all([
                    source.observe(effect.transactionHash, effect.envelope),
                    destination.observe(BASE_DEPLOYMENT_MIGRATION_CANDIDATE.destinationTransactionHash),
                ]);
                if (sourceObserved === null || destinationObserved === null)
                    bridgeFailure("APN_OPERATION_BLOCKED", "migration_transaction_missing");
                const [sourceDeployment, destinationDeployment, sourceFinalityBlock, destinationFinalityBlock] = await Promise.all([
                    source.deployment("across", request.toChainId, request.fromToken, sourceObserved.transaction.block),
                    destination.deployment("across", request.fromChainId, request.toToken, destinationObserved.transaction.block),
                    source.block(BASE_DEPLOYMENT_MIGRATION_CANDIDATE.sourceSafeBlock.numberAtomic),
                    destination.block(BASE_DEPLOYMENT_MIGRATION_CANDIDATE.destinationSafeBlock.numberAtomic),
                ]);
                const destinationProof = assertBaseDeploymentMigrationProof(raw, sourceObserved, sourceDeployment, destinationObserved, destinationDeployment, sourceFinalityBlock, destinationFinalityBlock);
                const migration = migrateBaseDeploymentOperation(raw, destinationProof);
                await this.records.migrateLegacyDeployment(raw, migration.operation, migration.audit);
                return migrationProjection(migration.operation, migration.audit, false);
            }
            if (isLegacyBridgeOperation(op))
                bridgeFailure("APN_OPERATION_BLOCKED", "migration_operation_kind");
            const eligible = migrateLineaDeploymentOperation(op, LINEA_DEPLOYMENT_MIGRATION_CANDIDATE.newDeployment);
            if (eligible.alreadyCurrent) {
                await this.records.repairMigratedDeployment(eligible.previousOperation, eligible.operation, eligible.audit);
                return migrationProjection(eligible.operation, eligible.audit, true);
            }
            const d = this.context.bridge;
            if (d === undefined)
                bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "bridge_runtime_unavailable");
            const rpc = d.rpcFor(op.intent.materialization.request.toChainId, session), request = op.intent.materialization.request;
            if (rpc.origin !== op.intent.destinationRpcOrigin)
                bridgeFailure("APN_OPERATION_BLOCKED", "migration_rpc_origin_mismatch");
            const hash = op.providerObservation?.destinationTransactionHash;
            if (typeof hash !== "string" || !hash.startsWith("0x"))
                bridgeFailure("APN_OPERATION_BLOCKED", "migration_destination_transaction_missing");
            const observed = await rpc.observe(hash, undefined, {
                recipient: request.recipient, from: bridgeProtocolEmitter(request.toChainId, "across", request.toToken),
                amountAtomic: op.sourceProof?.correlation.kind === "across" ? op.sourceProof.correlation.outputAmountAtomic : "0",
            });
            if (observed === null)
                bridgeFailure("APN_OPERATION_BLOCKED", "migration_destination_transaction_missing");
            const deployment = await rpc.deployment("across", request.fromChainId, request.toToken, observed.transaction.block);
            assertLineaDeploymentMigrationProof(observed.transaction, deployment);
            const migration = migrateLineaDeploymentOperation(op, deployment);
            await this.records.migrateDeployment(op, migration.operation, migration.audit);
            return migrationProjection(migration.operation, migration.audit, false);
        });
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
        const session = new RpcReadSession({ now: () => this.context.clock.now().getTime() });
        return new BridgeExecution(this.context.state, d.rpcFor(m.request.fromChainId, session), d.rpcFor(m.request.toChainId, session), d.provider, d.custody, () => this.context.clock.now().getTime(), async (previous, patch) => await this.save(previous, patch));
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
        if (isLegacyBridgeOperation(first.record))
            bridgeFailure("APN_OPERATION_BLOCKED", "legacy_bridge_non_resumable");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${operationId}`], async () => {
            const current = await this.operations.required(operationId);
            if (current.kind !== "bridge_route")
                bridgeFailure("APN_STATE_CORRUPT", "bridge_operation_kind_changed");
            if (isLegacyBridgeOperation(current.record))
                bridgeFailure("APN_OPERATION_BLOCKED", "legacy_bridge_non_resumable");
            await this.records.repairReceipt(current.record);
            await this.followUsage(current.record);
            return await work(current.record);
        });
    }
    async deploymentMigrationLocked(input, work) {
        const operationId = canonicalOperationId(input), first = await this.operations.required(operationId);
        if (first.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "migration_operation_kind");
        return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${operationId}`], async () => {
            const current = await this.operations.required(operationId);
            if (current.kind !== "bridge_route")
                bridgeFailure("APN_STATE_CORRUPT", "migration_operation_kind_changed");
            return await work(current.record);
        });
    }
}
function migrationProjection(operation, audit, alreadyCurrent) {
    return { schema_version: audit.schemaVersion, status: alreadyCurrent ? "already_current" : "migrated",
        proof_class: "local_journal_migration", operation: publicBridgeOperation(operation), audit,
        next_actions: operation.terminal ? [] : [`apn operation resume --operation ${operation.operationId}`] };
}
//# sourceMappingURL=service.js.map