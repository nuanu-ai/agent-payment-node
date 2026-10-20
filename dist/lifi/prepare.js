import { evmAddressLock, assertExclusiveEvmRawSigner } from "../evm-address-ownership.js";
import { walletCustodyLock } from "../encrypted-wallet-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { hashObject } from "../canonical.js";
import { OperationService } from "../operation-service.js";
import { bridgeConflictDomain } from "../operation-conflict-domain.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { decodeBridgeCall } from "./decode.js";
import { bridgeApprovalPolicyHash, bridgeApprovalRequired, bridgeExpiry, freezeBridgeEnvelopes } from "./economics.js";
import { newBridgeEffect } from "./operation-model.js";
import { BridgeOperationRepository } from "./operation-repository.js";
import { assertBridgeOwner, bridgeOwner } from "./owner.js";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession } from "./rpc.js";
import { BridgeQuoteRepository, newBridgeQuote } from "./quote-repository.js";
import { bridgeRouteProjection, materializeBridgeRoute, parseBridgeRoutes } from "./routes.js";
import { bridgeNoRouteEvidence } from "./no-route.js";
import { newBridgeOperation } from "./transitions.js";
import { bridgePreparePostBudget } from "./send-budget.js";
import { bridgeExecutionDestination, bridgeExecutionSource, bridgeNativePrincipal, validateBridgeRequest } from "./asset-registry.js";
import { bridgeFailure, bridgeHash, bridgeOpaque } from "./validation.js";
import { BridgeAllowlistGate } from "./allowlist.js";
import { BNB_COMPOSITE, verifyFlyHeaderSignature } from "./bnb-composite.js";
import { approvalData } from "./transaction.js";
export class BridgePreparation {
    o;
    constructor(o) {
        this.o = o;
    }
    async routes(profileInput, requestInput) {
        const profile = canonicalProfile(profileInput), request = validateBridgeRequest(requestInput), state = this.o.state;
        return await state.withLocks([`profile:${state.profileHash(profile)}`], async () => {
            const binding = await bridgeOwner(state, profile), response = await this.o.provider.routes(request, binding.owner.address);
            if (response.status !== 200)
                bridgeFailure("APN_PROVIDER_UNAVAILABLE", "route_discovery_status");
            const quote = newBridgeQuote({ profileHash: binding.owner.profileHash, ...binding, request, rawResponse: response.body,
                createdAt: new Date(this.o.now()).toISOString() });
            await this.o.quotes.save(quote);
            // An empty list is LI.FI's answer, never a route APN dropped: show what the provider said it filtered or failed.
            return { quote_hash: quote.snapshotHash, profile, request, response_hash: quote.responseHash,
                created_at: quote.createdAt, routes: quote.routes.map(bridgeRouteProjection), mainnet_acceptance: "open",
                ...(quote.routes.length === 0 ? { no_route: bridgeNoRouteEvidence(response.body, request) } : {}) };
        });
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), quoteHash = bridgeHash(input.quote, "APN_INVALID_INPUT"), routeId = bridgeOpaque(input.route, "APN_INVALID_INPUT");
        const key = canonicalIdempotencyKey(input.idempotencyKey), state = this.o.state, profileHash = state.profileHash(profile), operationId = state.operationId(profile, key), idempotencyHash = state.idempotencyHash(key), requestHash = hashObject({ profile, quote: quoteHash, route: routeId });
        // Existing journals are authoritative on replay, even if the original quote is unavailable.
        const preliminary = await this.o.operations.resolvePrepare({ kind: "bridge_route", profileHash, operationId, idempotencyHash, requestHash });
        const preliminaryQuote = preliminary === null ? await this.o.quotes.load(profileHash, quoteHash) : null;
        if (preliminary === null && preliminaryQuote === null)
            bridgeFailure("APN_INVALID_INPUT", "quote_not_owned_by_profile");
        const ownerAddress = preliminary?.kind === "bridge_route" ? preliminary.record.intent.owner.address : preliminaryQuote.owner.address;
        return await state.withLocks([walletCustodyLock(state, profile)], async () => await state.withLocks([`profile:${profileHash}`, `profile:${allowlistProfileHash(profile)}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`, evmAddressLock(ownerAddress)], async () => {
            const existing = await this.o.operations.resolvePrepare({ kind: "bridge_route", profileHash, operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "bridge_route")
                    bridgeFailure("APN_STATE_CORRUPT", "bridge_global_operation_kind");
                return existing.record;
            }
            const quote = await this.o.quotes.load(profileHash, quoteHash);
            if (quote === null)
                bridgeFailure("APN_INVALID_INPUT", "quote_not_owned_by_profile");
            // The source account claim (the one the stored bridge holds) is written before any provider or RPC read, and dropped
            // if no operation is written.
            return await this.o.operations.admit({ kind: "bridge_route", profileHash, operationId, idempotencyHash, requestHash }, { domains: () => [bridgeConflictDomain(quote.request.fromChainId, quote.owner.address)] }, async () => {
                await assertBridgeOwner(state, quote);
                await assertExclusiveEvmRawSigner(state, quote.owner.address, profileHash);
                const selected = parseBridgeRoutes({ status: 200, body: quote.rawResponse }, quote.request, quote.owner.address).find((r) => r.choice.routeId === routeId);
                if (selected === undefined)
                    bridgeFailure("APN_INVALID_INPUT", "route_not_in_snapshot");
                if (!bridgeExecutionDestination(quote.request.toChainId))
                    bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "destination_execution_unreviewed");
                if (!bridgeExecutionSource(quote.request.fromChainId))
                    bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "source_execution_unreviewed");
                if (!selected.choice.preparable)
                    bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_bridge_decoder_unavailable");
                const allowlist = await new BridgeAllowlistGate({ state, clock: { now: () => new Date(this.o.now()) } }, true)
                    .admit(profile, quote.owner.address, quote.request, selected.choice.tool);
                // One command-scoped read cache covers both sides of materialization. It is intentionally discarded before
                // approval or signing so mutable account, nonce and fee reads cannot cross an authority boundary. Only the
                // provider-family scheduler/cooldown spans phases. The cap is the prepare read plan with its retry headroom.
                const posts = bridgePreparePostBudget();
                const session = new RpcReadSession({ now: this.o.now, maxHttpRequests: posts, maxHttpAttempts: posts,
                    physicalBudget: new BridgeRpcPhysicalBudget(posts),
                    ...(this.o.providerScheduler === undefined ? {} : { providerScheduler: this.o.providerScheduler }) });
                const source = this.o.rpcFor(quote.request.fromChainId, session), destination = this.o.rpcFor(quote.request.toChainId, session);
                const response = await this.o.provider.materialize(selected.step), preparedAt = new Date(this.o.now()).toISOString();
                const parsed = materializeBridgeRoute(selected, response, quote.request, quote.owner.address), m = parsed.materialization, decoded = decodeBridgeCall(m);
                if (decoded.composite !== undefined)
                    await verifyFlyHeaderSignature(decoded.composite, BNB_COMPOSITE.signer);
                const planned = bridgeNativePrincipal(m.request) ? [m.transaction] : [{ chainId: m.request.fromChainId,
                        from: m.sender, to: m.request.fromToken, data: approvalData(m.approvalAddress, m.request.amountAtomic), valueAtomic: "0", gasLimitAtomic: "0" }];
                // Two POSTs on the primary endpoints: the source check with the account at its head, and the destination head with
                // its role's check. No archive endpoint and no safe-head history is needed to prepare.
                const [checked, destinationDeployment] = await Promise.all([
                    source.checkedAccount({ tool: m.tool, peerChainId: m.request.toChainId }, m.sender, m.approvalAddress, m.request.fromToken, planned),
                    destination.deploymentCheck(m.tool, m.request.fromChainId, m.request.toToken, "destination"),
                ]);
                const sourceDeployment = checked.deployment, sourceAccount = checked.account;
                if (parsed.providerNonceAtomic !== null && parsed.providerNonceAtomic !== (BigInt(sourceAccount.latestNonceAtomic) + (bridgeApprovalRequired(m.request, sourceAccount.allowanceAtomic) ? 1n : 0n)).toString())
                    bridgeFailure("APN_PROVIDER_PROTOCOL", "provider_nonce_conflict");
                const envelopes = await freezeBridgeEnvelopes(m, sourceAccount, source);
                const expiresAt = bridgeExpiry(m, decoded, sourceAccount, preparedAt, this.o.now());
                const operation = newBridgeOperation({ profileHash, operationId, idempotencyHash, requestHash,
                    intent: { profile, quoteHash, owner: quote.owner, providerBinding: quote.providerBinding, materialization: m, decoded,
                        sourceDeployment, destinationDeployment, sourceAccount, destinationStartBlock: destinationDeployment.block,
                        sourceRpcOrigin: source.origin, destinationRpcOrigin: destination.origin, preparedAt, expiresAt,
                        policyHash: bridgeApprovalPolicyHash(m),
                        implicitProtocolFeeAtomic: parsed.implicitProtocolFeeAtomic, allowlist },
                    effects: envelopes.map(newBridgeEffect) });
                await this.o.records.persist(operation);
                return operation;
            });
        }));
    }
}
//# sourceMappingURL=prepare.js.map