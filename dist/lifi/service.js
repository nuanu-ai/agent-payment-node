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
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession } from "./rpc.js";
import { bridgeDestinationObservationRequests, bridgeSourceObservationRequests } from "./observation-budget.js";
import { BRIDGE_OBSERVATION_RETRY_POSTS, BRIDGE_RESIDUAL_OBSERVATION_REQUESTS, bridgeInvocationPostBudget, bridgeSendStepPostBudget } from "./send-budget.js";
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
    async inventory() {
        try {
            return bridgeInventory(await this.dependencies().provider.inventory());
        }
        catch (error) {
            throw inventoryGuidance(error);
        }
    }
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
    async receipt(operationId) {
        const found = await this.operations.required(operationId);
        if (found.kind !== "bridge_route")
            bridgeFailure("APN_OPERATION_BLOCKED", "operation_is_not_bridge");
        if (isLegacyBridgeOperation(found.record))
            return await this.records.loadLegacyReceipt(found.record);
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
            operations: this.operations, provider: d.provider, rpcFor: d.rpcFor, now: () => this.context.clock.now().getTime(),
            providerScheduler: this.providerScheduler });
    }
    execution(op) {
        const d = this.dependencies(), m = op.intent.materialization, now = () => this.context.clock.now().getTime();
        // Every cap is derived from this operation's read plans (send-budget.ts): the send step of its unsent effects with retry
        // headroom, and the source, destination and residual observation sessions. An exhausted cap defers to the next resume.
        const physicalBudget = new BridgeRpcPhysicalBudget(bridgeInvocationPostBudget(op)), sendPosts = Math.max(1, bridgeSendStepPostBudget(op));
        const session = new RpcReadSession({ now, maxHttpRequests: sendPosts, maxHttpAttempts: sendPosts, providerScheduler: this.providerScheduler, physicalBudget });
        const lazy = (chainId, requests, retries) => {
            let rpc;
            return () => rpc ??= d.rpcFor(chainId, new RpcReadSession({ now, maxHttpRequests: requests, maxHttpAttempts: requests + retries,
                providerScheduler: this.providerScheduler, physicalBudget }));
        };
        const sourceObservation = lazy(m.request.fromChainId, bridgeSourceObservationRequests(op.effects.length), BRIDGE_OBSERVATION_RETRY_POSTS);
        const destinationObservation = lazy(m.request.toChainId, bridgeDestinationObservationRequests(m.request, op.intent.decoded.composite !== undefined), BRIDGE_OBSERVATION_RETRY_POSTS);
        const residualObservation = lazy(m.request.fromChainId, BRIDGE_RESIDUAL_OBSERVATION_REQUESTS, 1);
        return new BridgeExecution(this.context.state, d.rpcFor(m.request.fromChainId, session), d.rpcFor(m.request.toChainId, session), d.provider, d.custody, now, async (previous, patch) => await this.save(previous, patch), { source: sourceObservation, destination: destinationObservation, residual: residualObservation }, physicalBudget);
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
            await this.followUsage(current.record);
            return await work(current.record);
        }));
    }
}
/**
 * Inventory is an anonymous read of the LI.FI public API: no wallet, profile or signature is involved, so an unanswered
 * or refused read is retried as it is, never repaired by a wallet connect. The error itself is unchanged.
 */
function inventoryGuidance(error) {
    if (!(error instanceof ApnError) || error.code !== "APN_PROVIDER_UNAVAILABLE")
        return error;
    return new ApnError(error.code, error.message, { ...error.details, nextActions: [
            "Check network access to the LI.FI public API (https://li.quest/v1); this anonymous read uses no wallet or profile. Then rerun:",
            "apn bridge inventory"
        ] });
}
//# sourceMappingURL=service.js.map