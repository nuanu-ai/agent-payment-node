/** Prepare one Relay ERC-20 token-route quote (token-routes.ts) as a durable, unsigned, owner-policy-bound operation. */
import { getAddress } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { evmConflictDomain } from "../operation-conflict-domain.js";
import { freezeRelayUnsignedOperation, publicRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { isIdempotencyKey } from "../idempotency-key-contract.js";
import { requestRelayTokenQuote, withRelayTokenAllowanceActions } from "./token-quote.js";
import { relayTokenRouteFor } from "./token-routes.js";
const POSITIVE = /^[1-9][0-9]*$/u, ADDRESS = /^0x[0-9a-fA-F]{40}$/u, EIP155 = /^eip155:([1-9][0-9]{0,9})$/u;
function refuse(reason) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", "Relay unsigned prepare is not admitted by the active owner policy.", { reason });
}
function quoteRefused(reason, message, compared = {}, nextActions) {
    throw new ApnError("APN_OPERATION_BLOCKED", message, { reason, ...compared, ...(nextActions === undefined ? {} : { nextActions }) });
}
export async function prepareRelayToken(context, input) {
    const { state, clock, operations, ports } = context;
    const source = EIP155.exec(input.sourceChain), destination = EIP155.exec(input.destinationChain);
    if (source === null || destination === null || !ADDRESS.test(input.recipient) || /^0x0{40}$/u.test(input.recipient) ||
        ![input.amountAtomic, input.minOutputAtomic, input.maxApprovalNetworkFeeWei, input.maxDepositNetworkFeeWei].every(v => POSITIVE.test(v)) ||
        !isIdempotencyKey(input.idempotencyKey, 128))
        throw new ApnError("APN_INVALID_INPUT", "Relay token prepare inputs are invalid.");
    allowlistProfileHash(input.profile);
    const route = relayTokenRouteFor(Number(source[1]), input.asset, Number(destination[1]), input.destinationAsset);
    if (route === null)
        throw new ApnError("APN_INVALID_INPUT", "Relay has no token route between these chains and tokens.", { reason: "relay_token_route_unknown", nextActions: ["apn help relay prepare"] });
    const chain = `eip155:${route.source.chainId}`, asset = { kind: "token", identifier: route.source.address };
    const profileHash = state.profileHash(input.profile), operationId = state.operationId(input.profile, input.idempotencyKey);
    const idempotencyHash = state.idempotencyHash(input.idempotencyKey);
    const requestHash = hashObject({ command: "relay.token.prepare", ...input, recipient: input.recipient.toLowerCase(), routeReference: route.reference });
    const replay = await operations.resolvePrepare({ kind: "relay_unsigned", profileHash, operationId, idempotencyHash, requestHash });
    if (replay !== null) {
        if (replay.kind !== "relay_unsigned" || replay.record.tokenQuote?.routeReference !== route.reference)
            throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay token replay changed operation kind or route.");
        return await operations.relayStatus(replay.record);
    }
    const now = clock.now();
    if (!Number.isFinite(now.getTime()))
        throw new ApnError("APN_INVALID_INPUT", "Relay token prepare clock is invalid.");
    const active = await (ports.activePolicy?.(input.profile) ?? loadActiveAssetPolicyRegistry({ state, clock }, input.profile));
    if (active === null || active.profile !== input.profile || active.accounts.evm === undefined || !ADDRESS.test(active.accounts.evm))
        refuse("relay_token_active_owner_policy_required");
    if (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt)
        refuse("relay_policy_expired");
    const payer = active.accounts.evm.toLowerCase();
    const publicAccount = await (ports.publicAccount?.(input.profile) ?? state.loadWallet(profileHash).then(wallet => wallet?.address ?? null));
    if (publicAccount?.toLowerCase() !== payer)
        refuse("relay_public_profile_owner_mismatch");
    // Caps and daily usage are the source token's own: atomic in its decimals, under its chain and checksummed identity.
    const usage = await (ports.dailyUsage?.(active.accounts.evm, now) ?? new AssetUsageLedger(state.root).usage({
        account: getAddress(payer), chain, asset
    }, now).then(value => value.amountAtomic));
    const mechanism = { provider: "relay", reference: route.reference };
    const admission = evaluateAssetPolicy(active.registry, { chain, asset, rail: "bridge", mechanism, amountAtomic: input.amountAtomic,
        dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    if (!bridgeMechanismAdmitted(admission, mechanism))
        refuse("relay_token_route_pin_required");
    assertRecipientAdmitted({ admission, mechanism, recipient: input.recipient });
    await state.initialize();
    await state.withLocks([evmAddressLock(payer)], async () => await assertExclusiveEvmOwner(state, payer, profileHash));
    // The profile and the source account are claimed before the quote, and dropped if no operation is written.
    return await operations.admit({ kind: "relay_unsigned", profileHash, operationId, idempotencyHash, requestHash }, { profileWide: true, domains: () => [evmConflictDomain(route.source.chainId, payer)] }, async () => {
        const intent = { routeReference: route.reference, payer, recipient: input.recipient.toLowerCase(),
            amountAtomic: input.amountAtomic, minimumOutputAtomic: input.minOutputAtomic, nowSeconds: Math.floor(now.getTime() / 1000) };
        const quote = await (ports.tokenQuote?.(intent) ?? requestRelayTokenQuote(intent))
            .catch((error) => { throw withRelayTokenAllowanceActions(error, input.profile); });
        const { quoteDigest, ...projection } = quote;
        if (hashObject(projection) !== quoteDigest || quote.routeReference !== route.reference || quote.payer !== payer ||
            quote.recipient !== intent.recipient || quote.principalAtomic !== input.amountAtomic ||
            quote.sourceDecimals !== route.source.decimals || quote.destinationDecimals !== route.destination.decimals)
            quoteRefused("relay_quote_identity_changed", "The Relay quote does not bind this exact payer, recipient, route and amount.");
        if (BigInt(quote.minimumOutputAtomic) < BigInt(input.minOutputAtomic))
            quoteRefused("relay_quote_output_below_minimum", "The Relay quote's minimum output is below the requested minimum.", { quoted_minimum_output_atomic: quote.minimumOutputAtomic,
                requested_minimum_output_atomic: input.minOutputAtomic, destination_decimals: route.destination.decimals });
        const deadline = new Date(quote.deadline * 1000).toISOString();
        if (quote.deadline <= Math.floor(clock.now().getTime() / 1000) + 60)
            quoteRefused("relay_quote_expires_too_soon", "The Relay quote expires within a minute.", { quote_deadline: deadline });
        if (active.registry.expiresAt !== undefined && quote.deadline * 1000 > Date.parse(active.registry.expiresAt))
            quoteRefused("relay_quote_outlives_policy", "The Relay quote stays valid after the owner's allowlist policy expires; the owner must extend the policy first.", { quote_deadline: deadline, policy_expires_at: active.registry.expiresAt, policy_revision: active.revision }, [`apn allowlist policy status --profile ${input.profile}`]);
        for (const [leg, quoted, ceiling] of [["approval", quote.approval.maximumNetworkFeeWei, input.maxApprovalNetworkFeeWei],
            ["deposit", quote.deposit.maximumNetworkFeeWei, input.maxDepositNetworkFeeWei]]) {
            if (BigInt(quoted) > BigInt(ceiling))
                quoteRefused(`relay_${leg}_fee_above_ceiling`, `The Relay ${leg} network fee quote exceeds the caller's ceiling.`, { quoted_fee_wei: quoted, fee_ceiling_wei: ceiling });
        }
        const operation = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
            state: "prepared", terminal: false, profileHash, operationId, idempotencyHash, requestHash,
            sourceChainId: route.source.chainId, destinationChainId: route.destination.chainId, sourceAccount: payer, recipient: intent.recipient,
            quoteDigest, tokenQuote: quote, statusLocator: quote.statusLocator, policyDigest: active.digest, policyRevision: active.revision,
            approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei, depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
            amountAtomic: input.amountAtomic, minOutputAtomic: quote.minimumOutputAtomic, createdAt: now.toISOString(), deadline });
        return publicRelayUnsignedOperation(await operations.persistRelayUnsigned(operation));
    });
}
//# sourceMappingURL=token-prepare.js.map