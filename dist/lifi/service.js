import { evmAddressLock } from "../evm-address-ownership.js";
import { walletCustodyLock } from "../encrypted-wallet-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
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
import { BASE_DEPLOYMENT_MIGRATION_CANDIDATE, assertBaseDeploymentMigrationCandidate, assertBaseDeploymentMigrationProof, migrateBaseDeploymentOperation } from "./base-deployment-migration.js";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession } from "./rpc.js";
import { bridgeDestinationObservationRequests, bridgeSourceObservationRequests } from "./observation-budget.js";
import { BRIDGE_RESIDUAL_OBSERVATION_REQUESTS, bridgeInvocationPostBudget } from "./send-budget.js";
import { sha256 } from "../canonical.js";
export class BridgeService {
    context;
    records;
    operations;
    providerScheduler;
    constructor(context) {
        this.context = context;
        this.records = new BridgeOperationRepository(context.state.root);
        this.operations = new OperationService(context.state, context.providerX402Repository, undefined, this.records);
        this.providerScheduler = new RpcProviderScheduler({
            coordinate: async (family, work) => {
                const familyHash = sha256(`rpc-provider-family\0${family}`);
                // The lock intentionally covers a required cooldown/pacing wait and the HTTP attempt. A sibling process can
                // therefore fail with APN_STATE_BUSY when family work exceeds the state store's five-second lock wait.
                return await context.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await context.state.loadRpcProviderPacing(familyHash), async (value) => await context.state.writeRpcProviderPacing(familyHash, value), await context.state.loadRpcProviderCooldown(familyHash), async (value) => await context.state.writeRpcProviderCooldown(familyHash, value)));
            },
        });
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
        return await this.locked(operationId, async (op) => publicBridgeOperation(op.terminal || op.state === "awaiting_approval" ? op : await this.execution(op).resume(op, this.dependencies().approval)));
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
            // The recognized Base migration needs 29 clean POSTs: 12 source reads, then 17 destination
            // and finality reads after a durable source checkpoint. Each command gets a fresh physical cap.
            const session = new RpcReadSession({ now: () => this.context.clock.now().getTime(), maxHttpRequests: 31, maxHttpAttempts: 33,
                archiveDeploymentBatchMaxItems: 3,
                providerScheduler: this.providerScheduler, physicalBudget: new BridgeRpcPhysicalBudget() });
            if (raw.operationId === BASE_DEPLOYMENT_MIGRATION_CANDIDATE.operationId) {
                if (!isLegacyBridgeOperation(op)) {
                    const eligible = migrateBaseDeploymentOperation(raw);
                    await this.records.repairMigratedLegacyDeployment(eligible.previousOperation, eligible.operation, eligible.audit);
                    return migrationProjection(eligible.operation, eligible.audit, true);
                }
                assertBaseDeploymentMigrationCandidate(raw);
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
                const checkpoint = await this.records.baseMigrationSourceCheckpoint(raw);
                if (checkpoint === null) {
                    const sourceObserved = await source.observe(effect.transactionHash, effect.envelope);
                    if (sourceObserved === null)
                        bridgeFailure("APN_OPERATION_BLOCKED", "migration_transaction_missing");
                    const sourceDeployment = await source.deployment("across", request.toChainId, request.fromToken, sourceObserved.transaction.block);
                    await this.records.saveBaseMigrationSourceCheckpoint(raw, sourceObserved, sourceDeployment);
                    return { status: "pending", proof_class: "local_journal_migration", operation_id: raw.operationId,
                        next_actions: [`apn operation repair-deployment --operation ${raw.operationId}`] };
                }
                const destinationObserved = await destination.observe(BASE_DEPLOYMENT_MIGRATION_CANDIDATE.destinationTransactionHash);
                if (destinationObserved === null)
                    bridgeFailure("APN_OPERATION_BLOCKED", "migration_transaction_missing");
                const destinationDeployment = await destination.deployment("across", request.fromChainId, request.toToken, destinationObserved.transaction.block);
                const [sourceFinalityBlock, destinationFinalityBlock] = await Promise.all([
                    source.block(BASE_DEPLOYMENT_MIGRATION_CANDIDATE.sourceSafeBlock.numberAtomic),
                    destination.block(BASE_DEPLOYMENT_MIGRATION_CANDIDATE.destinationSafeBlock.numberAtomic),
                ]);
                const destinationProof = assertBaseDeploymentMigrationProof(raw, checkpoint.observation, checkpoint.deployment, destinationObserved, destinationDeployment, sourceFinalityBlock, destinationFinalityBlock);
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
            operations: this.operations, provider: d.provider, rpcFor: d.rpcFor, now: () => this.context.clock.now().getTime(),
            providerScheduler: this.providerScheduler, lineaArchiveDeploymentScalarCode: d.lineaArchiveDeploymentScalarCode === true });
    }
    execution(op) {
        const d = this.dependencies(), m = op.intent.materialization;
        // The invocation cap is derived from this operation's read plans for every route: the sign-and-send step with its retry
        // headroom plus the source, destination and residual observation sessions. An exhausted cap defers to the next resume.
        const physicalBudget = new BridgeRpcPhysicalBudget(undefined, undefined, bridgeInvocationPostBudget(op, 3));
        // The command session serves every guard of the invocation. The first full guard is counted in send-budget.ts from its read
        // plans (Base USDC with Ethereum or Arbitrum USDC Across: two safe heads, 10+7 archive chunks and two account batches = 21).
        // Base/Arbitrum Stargate retains only Base's operation-bound ordinary-code proof; Arbitrum code remains fully fresh.
        // Later guards reuse immutable evidence and read the two mutable account/simulation batches again.
        const session = new RpcReadSession({ now: () => this.context.clock.now().getTime(), maxHttpRequests: 28, maxHttpAttempts: 30,
            archiveDeploymentBatchMaxItems: 3, providerScheduler: this.providerScheduler, physicalBudget });
        const lazy = (chainId, options) => {
            let rpc;
            return () => rpc ??= d.rpcFor(chainId, new RpcReadSession({ ...options, providerScheduler: this.providerScheduler, physicalBudget }));
        };
        const common = { now: () => this.context.clock.now().getTime(), archiveDeploymentBatchMaxItems: 3 };
        // One source effect observation is bounded by its exact read plans: the canonical receipt sequence, Base's pinned fee
        // proof and the route's historical deployment proof after exact cache reuse (Base USDC to Arbitrum Across needs 19).
        // Protocol code, proxy/facet/implementation storage and caller-sensitive calls stay fresh; two attempts retain the retry reserve.
        const sourceRequests = bridgeSourceObservationRequests(m.request.fromChainId, m.request.toChainId, m.tool, m.request.fromToken, common.archiveDeploymentBatchMaxItems);
        const sourceObservation = lazy(m.request.fromChainId, { ...common, maxHttpRequests: sourceRequests, maxHttpAttempts: sourceRequests + 2 });
        // The destination proof is bounded the same way after the principal has left: canonical receipt, any provider-bound
        // native delivery reads, and the destination deployment chunks (Base USDC needs 17, the BNB composite 19).
        const destinationRequests = bridgeDestinationObservationRequests(m.request, m.tool, op.intent.decoded.composite !== undefined, common.archiveDeploymentBatchMaxItems);
        const destinationObservation = lazy(m.request.toChainId, { ...common, maxHttpRequests: destinationRequests, maxHttpAttempts: destinationRequests + 2 });
        const residualObservation = lazy(m.request.fromChainId, { ...common, maxHttpRequests: BRIDGE_RESIDUAL_OBSERVATION_REQUESTS,
            maxHttpAttempts: BRIDGE_RESIDUAL_OBSERVATION_REQUESTS + 1 });
        return new BridgeExecution(this.context.state, d.rpcFor(m.request.fromChainId, session), d.rpcFor(m.request.toChainId, session), d.provider, d.custody, () => this.context.clock.now().getTime(), async (previous, patch) => await this.save(previous, patch), { source: sourceObservation, destination: destinationObservation, residual: residualObservation }, physicalBudget);
    }
    async save(op, patch) {
        const next = transitionBridge(op, patch, this.context.clock.now().toISOString());
        await this.records.persist(next);
        await this.followUsage(next);
        return next;
    }
    async followUsage(op) {
        await new BridgeAllowlistGate(this.context, true).follow(op, bridgeUsageTarget(op));
    }
    async locked(input, work) {
        const operationId = canonicalOperationId(input), first = await this.operations.required(operationId);
        if (first.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "operation_is_not_bridge");
        if (isLegacyBridgeOperation(first.record))
            bridgeFailure("APN_OPERATION_BLOCKED", "legacy_bridge_non_resumable");
        return await this.context.state.withLocks([walletCustodyLock(this.context.state, first.record.intent.profile)], async () => await this.context.state.withLocks([`profile:${first.record.profileHash}`, `profile:${allowlistProfileHash(first.record.intent.profile)}`, `operation:${operationId}`, evmAddressLock(first.record.intent.owner.address)], async () => {
            const current = await this.operations.required(operationId);
            if (current.kind !== "bridge_route")
                bridgeFailure("APN_STATE_CORRUPT", "bridge_operation_kind_changed");
            if (isLegacyBridgeOperation(current.record))
                bridgeFailure("APN_OPERATION_BLOCKED", "legacy_bridge_non_resumable");
            await this.records.repairReceipt(current.record);
            await this.followUsage(current.record);
            return await work(current.record);
        }));
    }
    async deploymentMigrationLocked(input, work) {
        const operationId = canonicalOperationId(input), first = await this.operations.required(operationId);
        if (first.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "migration_operation_kind");
        return await this.context.state.withLocks([walletCustodyLock(this.context.state, first.record.intent.profile)], async () => await this.context.state.withLocks([`profile:${first.record.profileHash}`, `profile:${allowlistProfileHash(first.record.intent.profile)}`, `operation:${operationId}`, evmAddressLock(first.record.intent.owner.address)], async () => {
            const current = await this.operations.required(operationId);
            if (current.kind !== "bridge_route")
                bridgeFailure("APN_STATE_CORRUPT", "migration_operation_kind_changed");
            return await work(current.record);
        }));
    }
}
function migrationProjection(operation, audit, alreadyCurrent) {
    return { schema_version: audit.schemaVersion, status: alreadyCurrent ? "already_current" : "migrated",
        proof_class: "local_journal_migration", operation: publicBridgeOperation(operation), audit,
        next_actions: operation.terminal ? [] : [`apn operation resume --operation ${operation.operationId}`] };
}
//# sourceMappingURL=service.js.map