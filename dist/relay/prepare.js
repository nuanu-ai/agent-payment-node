/** Prepare one Relay quote as a durable, unsigned owner-policy-bound operation. */
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { OperationService } from "../operation-service.js";
import { freezeRelayUnsignedOperation, publicRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { ETHEREUM_USDC, requestRelayQuote } from "./quote.js";
export const RELAY_ROUTE_REFERENCE = "ethereum-usdc-bnb-native-v1";
const POSITIVE = /^[1-9][0-9]*$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
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
    async prepare(input) {
        if (input.profile !== "default")
            refuse("relay_default_profile_only");
        if (!ADDRESS.test(input.recipient) ||
            ![input.amountAtomic, input.minOutputAtomic, input.maxApprovalNetworkFeeWei, input.maxDepositNetworkFeeWei].every(v => POSITIVE.test(v)) ||
            !/^[A-Za-z0-9._:-]{8,128}$/u.test(input.idempotencyKey)) {
            throw new ApnError("APN_INVALID_INPUT", "Relay prepare inputs are invalid.");
        }
        allowlistProfileHash(input.profile);
        const profileHash = this.state.profileHash(input.profile);
        const operationId = this.state.operationId(input.profile, input.idempotencyKey);
        const idempotencyHash = this.state.idempotencyHash(input.idempotencyKey);
        const requestHash = hashObject({ ...input, recipient: input.recipient.toLowerCase() });
        const replay = await this.operations.resolvePrepare({ kind: "relay_unsigned", profileHash, operationId,
            idempotencyHash, requestHash });
        if (replay !== null) {
            if (replay.kind !== "relay_unsigned")
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay replay changed operation kind.");
            return publicRelayUnsignedOperation(replay.record);
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
            dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        const pin = admission.asset.mechanismPins?.bridge;
        if (pin?.provider !== "relay" || pin.reference !== RELAY_ROUTE_REFERENCE)
            refuse("relay_route_pin_required");
        await this.state.initialize();
        // Fail closed before quoting. The final owner check and create-only write
        // share one profile/operation/address critical section in OperationService.
        const checkOwner = async () => await this.state.withLocks([evmAddressLock(payer)], async () => await assertExclusiveEvmOwner(this.state, payer, profileHash));
        await checkOwner();
        await this.operations.assertProfileAvailable(profileHash);
        const intent = { payer, recipient: input.recipient.toLowerCase(), amountAtomic: input.amountAtomic,
            minimumOutputWei: input.minOutputAtomic, nowSeconds: Math.floor(now.getTime() / 1000) };
        const quote = await (this.ports.quote?.(intent) ?? requestRelayQuote(intent));
        const { quoteDigest, ...projection } = quote;
        if (hashObject(projection) !== quoteDigest || quote.payer !== payer || quote.recipient !== intent.recipient ||
            quote.principalAtomic !== input.amountAtomic || BigInt(quote.minimumOutputWei) < BigInt(input.minOutputAtomic) ||
            quote.deadline <= Math.floor(this.clock.now().getTime() / 1000) + 60 ||
            (active.registry.expiresAt !== undefined && quote.deadline * 1000 > Date.parse(active.registry.expiresAt)) ||
            BigInt(quote.approval.maximumNetworkFeeWei) > BigInt(input.maxApprovalNetworkFeeWei) ||
            BigInt(quote.deposit.maximumNetworkFeeWei) > BigInt(input.maxDepositNetworkFeeWei)) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay quote identity, deadline, or fee ceiling changed.");
        }
        const operation = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1",
            kind: "relay_unsigned", state: "prepared", terminal: false, profileHash, operationId, idempotencyHash,
            requestHash, sourceChainId: 1, destinationChainId: 56, sourceAccount: payer, recipient: intent.recipient,
            quoteDigest, quote, policyDigest: active.digest, policyRevision: active.revision,
            approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
            depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
            amountAtomic: input.amountAtomic, minOutputAtomic: quote.minimumOutputWei,
            createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
        return publicRelayUnsignedOperation(await this.operations.persistRelayUnsigned(operation));
    }
}
//# sourceMappingURL=prepare.js.map