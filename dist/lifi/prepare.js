import { hashObject } from "../canonical.js";
import { OperationService } from "../operation-service.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { decodeBridgeCall } from "./decode.js";
import { bridgeApprovalRequired, bridgeExpiry, freezeBridgeEnvelopes } from "./economics.js";
import { newBridgeEffect } from "./operation-model.js";
import { BridgeOperationRepository } from "./operation-repository.js";
import { assertBridgeOwner, bridgeOwner } from "./owner.js";
import { RpcReadSession } from "./rpc.js";
import { BridgeQuoteRepository, newBridgeQuote } from "./quote-repository.js";
import { bridgeRouteProjection, materializeBridgeRoute, parseBridgeRoutes } from "./routes.js";
import { newBridgeOperation } from "./transitions.js";
import { bridgeExecutionDestination, validateBridgeRequest } from "./asset-registry.js";
import { bridgeFailure, bridgeHash, bridgeOpaque } from "./validation.js";
import { BridgeAllowlistGate } from "./allowlist.js";
import { isLegacyBridgeOperation } from "./legacy-operation.js";
import { BNB_COMPOSITE, verifyFlyHeaderSignature } from "./bnb-composite.js";
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
            return { quote_hash: quote.snapshotHash, profile, request, response_hash: quote.responseHash,
                created_at: quote.createdAt, routes: quote.routes.map(bridgeRouteProjection), mainnet_acceptance: "open" };
        });
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), quoteHash = bridgeHash(input.quote, "APN_INVALID_INPUT"), routeId = bridgeOpaque(input.route, "APN_INVALID_INPUT");
        const key = canonicalIdempotencyKey(input.idempotencyKey), state = this.o.state, profileHash = state.profileHash(profile), operationId = state.operationId(profile, key), idempotencyHash = state.idempotencyHash(key), requestHash = hashObject({ profile, quote: quoteHash, route: routeId });
        return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
            const existing = await this.o.operations.resolvePrepare({ kind: "bridge_route", profileHash, operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "bridge_route")
                    bridgeFailure("APN_STATE_CORRUPT", "bridge_global_operation_kind");
                if (!isLegacyBridgeOperation(existing.record))
                    await this.o.records.repairReceipt(existing.record);
                return existing.record;
            }
            const quote = await this.o.quotes.load(profileHash, quoteHash);
            if (quote === null)
                bridgeFailure("APN_INVALID_INPUT", "quote_not_owned_by_profile");
            await this.o.operations.assertEvmAccountAvailable(profileHash, quote.request.fromChainId, quote.owner.address);
            await assertBridgeOwner(state, quote);
            const selected = parseBridgeRoutes({ status: 200, body: quote.rawResponse }, quote.request, quote.owner.address).find((r) => r.choice.routeId === routeId);
            if (selected === undefined)
                bridgeFailure("APN_INVALID_INPUT", "route_not_in_snapshot");
            if (!bridgeExecutionDestination(quote.request.toChainId))
                bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "destination_execution_unreviewed");
            if (!selected.choice.preparable)
                bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_bridge_decoder_unavailable");
            const allowlist = await new BridgeAllowlistGate({ state, clock: { now: () => new Date(this.o.now()) } })
                .admit(profile, quote.owner.address, quote.request, selected.choice.tool);
            // One command-scoped session covers both sides of materialization. It is intentionally discarded before
            // approval or signing so mutable account, nonce and fee reads cannot cross an authority boundary.
            const session = new RpcReadSession({ now: this.o.now });
            const source = this.o.rpcFor(quote.request.fromChainId, session), destination = this.o.rpcFor(quote.request.toChainId, session);
            const [sourceSafeBlock, destinationSafeBlock, response] = await Promise.all([
                source.block("safe"), destination.block("safe"), this.o.provider.materialize(selected.step),
            ]), preparedAt = new Date(this.o.now()).toISOString();
            const parsed = materializeBridgeRoute(selected, response, quote.request, quote.owner.address), m = parsed.materialization, decoded = decodeBridgeCall(m);
            if (decoded.composite !== undefined)
                await verifyFlyHeaderSignature(decoded.composite, BNB_COMPOSITE.signer);
            const [sourceDeployment, destinationDeployment] = await Promise.all([
                source.deployment(m.tool, m.request.toChainId, m.request.fromToken, sourceSafeBlock),
                destination.deployment(m.tool, m.request.fromChainId, m.request.toToken, destinationSafeBlock),
            ]);
            const sourceAccount = await source.account(m.sender, m.approvalAddress, m.request.fromToken);
            if (parsed.providerNonceAtomic !== null && parsed.providerNonceAtomic !== (BigInt(sourceAccount.latestNonceAtomic) + (bridgeApprovalRequired(m.request, sourceAccount.allowanceAtomic) ? 1n : 0n)).toString())
                bridgeFailure("APN_PROVIDER_PROTOCOL", "provider_nonce_conflict");
            const envelopes = await freezeBridgeEnvelopes(m, sourceAccount, source);
            const expiresAt = bridgeExpiry(m, decoded, sourceAccount, preparedAt, this.o.now());
            const operation = newBridgeOperation({ profileHash, operationId, idempotencyHash, requestHash,
                intent: { profile, quoteHash, owner: quote.owner, providerBinding: quote.providerBinding, materialization: m, decoded,
                    sourceDeployment, destinationDeployment, sourceAccount, destinationStartBlock: destinationSafeBlock,
                    sourceRpcOrigin: source.origin, destinationRpcOrigin: destination.origin, preparedAt, expiresAt,
                    policyHash: hashObject({ identity: "apn.bridge.foreground-approval.v1", request: m.request }),
                    implicitProtocolFeeAtomic: parsed.implicitProtocolFeeAtomic, allowlist },
                effects: envelopes.map(newBridgeEffect) });
            await this.o.records.persist(operation);
            return operation;
        });
    }
}
//# sourceMappingURL=prepare.js.map