/** Prepare one Relay quote as a durable, unsigned owner-policy-bound operation. */
import { hashObject } from "../canonical.js";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { getAddress } from "viem";
import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { OperationService } from "../operation-service.js";
import { evmConflictDomain } from "../operation-conflict-domain.js";
import { freezeRelayUnsignedOperation, publicRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { ETHEREUM_USDC, requestRelayQuote, withRelayAllowanceActions } from "./quote.js";
import { requestRelayNativeQuote } from "./native-quote.js";
import { relayNativeRouteFor } from "./native-routes.js";
import { createRelayArbitrumSourceDraft } from "./arbitrum-usdc-source-draft.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";
import { relayStatusLocator } from "./quote.js";
export const RELAY_ROUTE_REFERENCE = "ethereum-usdc-bnb-native-v1";
export const RELAY_BASE_ROUTE_REFERENCE = "ethereum-usdc-base-eth-v1";
const POSITIVE = /^[1-9][0-9]*$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const EIP155 = /^eip155:([1-9][0-9]{0,9})$/u;
function refuse(reason) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", "Relay unsigned prepare is not admitted by the active owner policy.", { reason });
}
export class RelayUnsignedPrepareService {
    state;
    clock;
    operations;
    ports;
    constructor(state, clock, operations = new OperationService(state), ports = {}) {
        this.state = state;
        this.clock = clock;
        this.operations = operations;
        this.ports = ports;
    }
    async prepare(input, route = "bnb") {
        if (!ADDRESS.test(input.recipient) || /^0x0{40}$/u.test(input.recipient) ||
            ![input.amountAtomic, input.minOutputAtomic, input.maxApprovalNetworkFeeWei, input.maxDepositNetworkFeeWei].every(v => POSITIVE.test(v)) ||
            !/^[A-Za-z0-9._:-]{8,128}$/u.test(input.idempotencyKey)) {
            throw new ApnError("APN_INVALID_INPUT", "Relay prepare inputs are invalid.");
        }
        allowlistProfileHash(input.profile);
        const profileHash = this.state.profileHash(input.profile);
        const operationId = this.state.operationId(input.profile, input.idempotencyKey);
        const idempotencyHash = this.state.idempotencyHash(input.idempotencyKey);
        const requestHash = hashObject({ ...input, recipient: input.recipient.toLowerCase(), ...(route === "base" ? { route } : {}) });
        const replay = await this.operations.resolvePrepare({ kind: "relay_unsigned", profileHash, operationId,
            idempotencyHash, requestHash });
        if (replay !== null) {
            if (replay.kind !== "relay_unsigned" || replay.record.destinationChainId !== (route === "base" ? 8453 : 56))
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay replay changed operation kind or route.");
            return await this.operations.relayStatus(replay.record);
        }
        const now = this.clock.now();
        if (!Number.isFinite(now.getTime()))
            throw new ApnError("APN_INVALID_INPUT", "Relay prepare clock is invalid.");
        const active = await (this.ports.activePolicy?.(input.profile) ?? loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile));
        if (active === null || active.profile !== input.profile || active.accounts.evm === undefined ||
            !ADDRESS.test(active.accounts.evm))
            refuse("relay_active_owner_policy_required");
        if (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt)
            refuse("relay_policy_expired");
        const payer = active.accounts.evm.toLowerCase();
        const publicAccount = await (this.ports.publicAccount?.(input.profile) ??
            this.state.loadWallet(profileHash).then(wallet => wallet?.address ?? null));
        if (publicAccount?.toLowerCase() !== payer)
            refuse("relay_public_profile_owner_mismatch");
        const usage = await (this.ports.dailyUsage?.(active.accounts.evm, now) ?? new AssetUsageLedger(this.state.root).usage({
            account: active.accounts.evm, chain: "eip155:1", asset: { kind: "token", identifier: ETHEREUM_USDC },
        }, now).then(value => value.amountAtomic));
        const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:1",
            asset: { kind: "token", identifier: ETHEREUM_USDC }, rail: "bridge", amountAtomic: input.amountAtomic,
            dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString(),
            mechanism: { provider: "relay", reference: route === "base" ? RELAY_BASE_ROUTE_REFERENCE : RELAY_ROUTE_REFERENCE } });
        const mechanism = { provider: "relay", reference: route === "base" ? RELAY_BASE_ROUTE_REFERENCE : RELAY_ROUTE_REFERENCE };
        if (!bridgeMechanismAdmitted(admission, mechanism))
            refuse("relay_route_pin_required");
        assertRecipientAdmitted({ admission, mechanism, recipient: input.recipient });
        await this.state.initialize();
        // Fail closed before quoting. The final owner check and create-only write
        // share one profile/operation/address critical section in OperationService.
        const checkOwner = async () => await this.state.withLocks([evmAddressLock(payer)], async () => await assertExclusiveEvmOwner(this.state, payer, profileHash));
        await checkOwner();
        // The profile and the source account are claimed before the quote, and dropped if no operation is written.
        return await this.operations.admit({ kind: "relay_unsigned", profileHash, operationId, idempotencyHash, requestHash }, { profileWide: true, domains: () => [evmConflictDomain(1, payer)] }, async () => {
            const intent = { payer, recipient: input.recipient.toLowerCase(), amountAtomic: input.amountAtomic,
                minimumOutputWei: input.minOutputAtomic, nowSeconds: Math.floor(now.getTime() / 1000),
                ...(route === "base" ? { destinationChainId: 8453 } : {}) };
            const quote = await (this.ports.quote?.(intent) ?? requestRelayQuote(intent))
                .catch((error) => { throw withRelayAllowanceActions(error, input.profile); });
            const { quoteDigest, ...projection } = quote;
            if (hashObject(projection) !== quoteDigest || quote.payer !== payer || quote.recipient !== intent.recipient ||
                quote.orderData.output.chainId !== route || quote.routeReference !== (route === "base" ? RELAY_BASE_ROUTE_REFERENCE : undefined) ||
                quote.principalAtomic !== input.amountAtomic || BigInt(quote.minimumOutputWei) < BigInt(input.minOutputAtomic) ||
                quote.deadline <= Math.floor(this.clock.now().getTime() / 1000) + 60 ||
                (active.registry.expiresAt !== undefined && quote.deadline * 1000 > Date.parse(active.registry.expiresAt)) ||
                BigInt(quote.approval.maximumNetworkFeeWei) > BigInt(input.maxApprovalNetworkFeeWei) ||
                BigInt(quote.deposit.maximumNetworkFeeWei) > BigInt(input.maxDepositNetworkFeeWei)) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Relay quote identity, deadline, or fee ceiling changed.");
            }
            const operation = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1",
                kind: "relay_unsigned", state: "prepared", terminal: false, profileHash, operationId, idempotencyHash,
                requestHash, sourceChainId: 1, destinationChainId: route === "base" ? 8453 : 56, sourceAccount: payer, recipient: intent.recipient,
                quoteDigest, quote, ...(quote.statusLocator === undefined ? {} : { statusLocator: quote.statusLocator }),
                policyDigest: active.digest, policyRevision: active.revision,
                approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
                depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
                amountAtomic: input.amountAtomic, minOutputAtomic: quote.minimumOutputWei,
                createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
            return publicRelayUnsignedOperation(await this.operations.persistRelayUnsigned(operation));
        });
    }
    async prepareBase(input) { return this.prepare(input, "base"); }
    /** A local quote file is validated before create-only persistence; no network or wallet is used. */
    async prepareArbitrum(input) {
        allowlistProfileHash(input.profile);
        if (!ADDRESS.test(input.owner) || !ADDRESS.test(input.recipient) || /^0x0{40}$/u.test(input.recipient) || !isAbsolute(input.quoteFile) ||
            ![input.amountAtomic, input.minOutputAtomic, input.maxProviderFeeAtomic,
                input.maxApprovalNetworkFeeWei, input.maxDepositNetworkFeeWei].every(v => POSITIVE.test(v)) ||
            !/^[A-Za-z0-9._:-]{8,128}$/u.test(input.idempotencyKey)) {
            throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum prepare inputs are invalid.");
        }
        const profileHash = this.state.profileHash(input.profile);
        const operationId = this.state.operationId(input.profile, input.idempotencyKey);
        const idempotencyHash = this.state.idempotencyHash(input.idempotencyKey);
        const owner = input.owner.toLowerCase();
        const requestHash = hashObject({ command: "relay.arbitrum.prepare", ...input, owner, recipient: input.recipient.toLowerCase() });
        const replay = await this.operations.resolvePrepare({ kind: "relay_unsigned", profileHash, operationId,
            idempotencyHash, requestHash });
        if (replay !== null) {
            if (replay.kind !== "relay_unsigned" || replay.record.sourceChainId !== 42161 ||
                replay.record.arbitrumDraft === undefined) {
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay Arbitrum replay changed operation kind or route.");
            }
            return this.operations.relayStatus(replay.record);
        }
        const now = this.clock.now();
        if (!Number.isFinite(now.getTime()))
            throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum prepare clock is invalid.");
        const active = await (this.ports.activePolicy?.(input.profile) ?? loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile));
        if (active === null || active.profile !== input.profile || active.accounts.evm?.toLowerCase() !== owner)
            refuse("relay_arbitrum_active_owner_policy_required");
        const usage = await (this.ports.dailyUsage?.(owner, now) ?? new AssetUsageLedger(this.state.root).usage({
            // The ledger keys usage by the checksum account, the spelling every reservation is written under.
            account: getAddress(owner), chain: "eip155:42161", asset: { kind: "token", identifier: RELAY_ARBITRUM_USDC },
        }, now).then(value => value.amountAtomic));
        await this.state.initialize();
        await this.state.withLocks([evmAddressLock(owner)], async () => assertExclusiveEvmOwner(this.state, owner, profileHash));
        // The profile and the source account are claimed before the quote, and dropped if no operation is written.
        return await this.operations.admit({ kind: "relay_unsigned", profileHash, operationId, idempotencyHash, requestHash }, { profileWide: true, domains: () => [evmConflictDomain(42161, owner)] }, async () => {
            const rawQuote = await (this.ports.arbitrumQuoteFile?.(input.quoteFile) ?? (async () => {
                const file = await open(input.quoteFile, constants.O_RDONLY | constants.O_NOFOLLOW)
                    .catch(() => { throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum quote file cannot be opened."); });
                try {
                    const stat = await file.stat();
                    if (!stat.isFile() || stat.size > 65_536)
                        throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum quote file is invalid or too large.");
                    const bytes = await file.readFile();
                    if (bytes.length > 65_536)
                        throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum quote file is too large.");
                    return JSON.parse(bytes.toString("utf8"));
                }
                finally {
                    await file.close();
                }
            })());
            const draft = await createRelayArbitrumSourceDraft({ profile: input.profile, owner, recipient: input.recipient, publicAccount: owner,
                amountAtomic: input.amountAtomic, minimumOutputAtomic: input.minOutputAtomic,
                maxProviderFeeAtomic: input.maxProviderFeeAtomic,
                maxApprovalNetworkFeeWei: input.maxApprovalNetworkFeeWei,
                maxDepositNetworkFeeWei: input.maxDepositNetworkFeeWei, dailyUsageAtomic: usage,
                activePolicy: active, rawQuote, now });
            const operation = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1",
                kind: "relay_unsigned", state: "prepared", terminal: false, profileHash, operationId, idempotencyHash,
                requestHash, sourceChainId: 42161, destinationChainId: 1, sourceAccount: owner,
                recipient: draft.recipient.toLowerCase(), quoteDigest: draft.quoteDigest,
                statusLocator: relayStatusLocator(draft.requestId), arbitrumDraft: draft,
                policyDigest: draft.policyDigest, policyRevision: draft.policyRevision,
                approvalNetworkFeeCeilingWei: draft.maxApprovalNetworkFeeWei,
                depositNetworkFeeCeilingWei: draft.maxDepositNetworkFeeWei,
                amountAtomic: draft.amountAtomic, minOutputAtomic: draft.minimumOutputAtomic,
                createdAt: draft.createdAt, deadline: draft.deadline });
            return publicRelayUnsignedOperation(await this.operations.persistRelayUnsigned(operation));
        });
    }
    async prepareNative(input) {
        const source = EIP155.exec(input.sourceChain), destination = EIP155.exec(input.destinationChain);
        if (source === null || destination === null || !ADDRESS.test(input.recipient) || /^0x0{40}$/u.test(input.recipient) ||
            ![input.amountAtomic, input.minOutputAtomic, input.maxDepositNetworkFeeWei].every(v => POSITIVE.test(v)) ||
            !/^[A-Za-z0-9._:-]{8,128}$/u.test(input.idempotencyKey)) {
            throw new ApnError("APN_INVALID_INPUT", "Relay native prepare inputs are invalid.");
        }
        allowlistProfileHash(input.profile);
        // The route is protocol data chosen by the caller's chains; payer, recipient, amount and fee ceiling are the caller's.
        const route = relayNativeRouteFor(Number(source[1]), Number(destination[1]));
        if (route === null)
            throw new ApnError("APN_INVALID_INPUT", "Relay native has no route between these chains.", { reason: "relay_native_route_unknown" });
        const profileHash = this.state.profileHash(input.profile);
        const operationId = this.state.operationId(input.profile, input.idempotencyKey);
        const idempotencyHash = this.state.idempotencyHash(input.idempotencyKey);
        const requestHash = hashObject({ ...input, recipient: input.recipient.toLowerCase(), routeReference: route.reference });
        const replay = await this.operations.resolvePrepare({ kind: "relay_unsigned", profileHash, operationId,
            idempotencyHash, requestHash });
        if (replay !== null) {
            if (replay.kind !== "relay_unsigned" || replay.record.nativeQuote?.routeReference !== route.reference) {
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay native replay changed operation kind or route.");
            }
            return this.operations.relayStatus(replay.record);
        }
        const now = this.clock.now();
        if (!Number.isFinite(now.getTime()))
            throw new ApnError("APN_INVALID_INPUT", "Relay native prepare clock is invalid.");
        const active = await (this.ports.activePolicy?.(input.profile) ?? loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile));
        if (active === null || active.profile !== input.profile || active.accounts.evm === undefined ||
            !ADDRESS.test(active.accounts.evm))
            refuse("relay_native_active_owner_policy_required");
        if (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt)
            refuse("relay_policy_expired");
        const payer = active.accounts.evm.toLowerCase();
        const publicAccount = await (this.ports.publicAccount?.(input.profile) ??
            this.state.loadWallet(profileHash).then(wallet => wallet?.address ?? null));
        if (publicAccount?.toLowerCase() !== payer)
            refuse("relay_public_profile_owner_mismatch");
        const usage = await (this.ports.dailyUsage?.(active.accounts.evm, now) ?? new AssetUsageLedger(this.state.root).usage({
            account: active.accounts.evm, chain: `eip155:${route.sourceChainId}`, asset: { kind: "native", identifier: null },
        }, now).then(value => value.amountAtomic));
        const mechanism = { provider: "relay", reference: route.reference };
        const admission = evaluateAssetPolicy(active.registry, { chain: `eip155:${route.sourceChainId}`,
            asset: { kind: "native", identifier: null }, rail: "bridge", mechanism, amountAtomic: input.amountAtomic,
            dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        if (!bridgeMechanismAdmitted(admission, mechanism))
            refuse("relay_native_route_pin_required");
        assertRecipientAdmitted({ admission, mechanism, recipient: input.recipient });
        await this.state.initialize();
        const checkOwner = async () => this.state.withLocks([evmAddressLock(payer)], async () => assertExclusiveEvmOwner(this.state, payer, profileHash));
        await checkOwner();
        // The profile and the source account are claimed before the quote, and dropped if no operation is written.
        return await this.operations.admit({ kind: "relay_unsigned", profileHash, operationId, idempotencyHash, requestHash }, { profileWide: true, domains: () => [evmConflictDomain(route.sourceChainId, payer)] }, async () => {
            const intent = { payer, recipient: input.recipient.toLowerCase(), amountAtomic: input.amountAtomic,
                minimumOutputWei: input.minOutputAtomic, nowSeconds: Math.floor(now.getTime() / 1000), routeReference: route.reference,
                maximumNetworkFeeWei: input.maxDepositNetworkFeeWei };
            const quote = await (this.ports.nativeQuote?.(intent) ?? requestRelayNativeQuote(intent));
            const { quoteDigest, ...projection } = quote;
            // A Base order's signed deadline bounds settlement/refunds, not local source-effect authority.
            const authorizationDeadline = Math.min(quote.deadline * 1000 - 60_000, active.registry.expiresAt === undefined ? Infinity : Date.parse(active.registry.expiresAt));
            if (route.sourceChainId === 8453) {
                const current = await (this.ports.activePolicy?.(input.profile) ?? loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile));
                const at = this.clock.now().getTime();
                if (current === null || current.profile !== active.profile || current.digest !== active.digest || current.revision !== active.revision ||
                    current.activationDigest !== active.activationDigest || current.accounts.evm?.toLowerCase() !== payer ||
                    !Number.isFinite(at) || !Number.isFinite(authorizationDeadline) || at >= authorizationDeadline)
                    refuse("relay_native_authorization_window");
            }
            if (hashObject(projection) !== quoteDigest || quote.routeReference !== route.reference ||
                quote.payer !== payer || quote.recipient !== intent.recipient || quote.principalAtomic !== input.amountAtomic ||
                BigInt(quote.minimumOutputWei) < BigInt(input.minOutputAtomic) ||
                quote.deadline <= Math.floor(this.clock.now().getTime() / 1000) + 60 ||
                (route.sourceChainId !== 8453 && active.registry.expiresAt !== undefined && quote.deadline * 1000 > Date.parse(active.registry.expiresAt)) ||
                BigInt(quote.deposit.maximumNetworkFeeWei) > BigInt(input.maxDepositNetworkFeeWei)) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Relay native quote identity, deadline, or fee ceiling changed.");
            }
            const operation = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1",
                kind: "relay_unsigned", state: "prepared", terminal: false, profileHash, operationId, idempotencyHash,
                requestHash, sourceChainId: route.sourceChainId, destinationChainId: route.chainId, sourceAccount: payer, recipient: intent.recipient,
                quoteDigest, nativeQuote: quote, ...(quote.statusLocator === undefined ? {} : { statusLocator: quote.statusLocator }),
                policyDigest: active.digest, policyRevision: active.revision,
                ...(route.sourceChainId === 8453 ? { policyActivationDigest: active.activationDigest } : {}),
                depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
                amountAtomic: input.amountAtomic, minOutputAtomic: quote.minimumOutputWei,
                createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
            return publicRelayUnsignedOperation(await this.operations.persistRelayUnsigned(operation));
        });
    }
}
//# sourceMappingURL=prepare.js.map