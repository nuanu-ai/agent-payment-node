import { hashObject, sha256 } from "./canonical.js";
import { APPROVAL_WINDOW_MS, BASE_USDC, CHAIN_ID, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { gaslessCommandRequest } from "./gasless/command-input.js";
import { formatAtomic } from "./money.js";
import { appendTransition, sealOperation } from "./state.js";
import { canonicalAddress, canonicalIdempotencyKey, publicOperation } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { COINBASE_ENTRY_POINT, coinbaseGaslessSnapshot, observeCoinbaseGasless } from "./coinbase-gasless-observer.js";
const DIRECT_POLICY = {
    identity: "apn.direct.foreground-approval.v1",
    verdict: "foreground_approval_required",
    foregroundApprovalRequired: true,
};
export async function prepareCoinbaseGasless(context, operations, durable, loadProfile, request) {
    const profile = canonicalProfile(request.profile), gasless = gaslessCommandRequest(request.request);
    if (gasless.chainId !== CHAIN_ID)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Coinbase gasless supports Base USDC only.");
    const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey), recipient = canonicalAddress(gasless.recipient);
    const gross = BigInt(gasless.grossAtomic), minimum = BigInt(gasless.minReceivedAtomic), maximumFee = BigInt(gasless.maxFeeAtomic);
    if (gross <= 0n || minimum <= 0n || minimum > gross || maximumFee < 0n)
        throw new ApnError("APN_INVALID_INPUT", "Coinbase gasless amount bounds are invalid.");
    await context.ready();
    const state = context.state, profileHash = state.profileHash(profile), operationId = state.operationId(profile, idempotencyKey);
    const idempotencyHash = state.idempotencyHash(idempotencyKey), rpcBindingHash = sha256(`direct-rpc\0${context.requireCoinbaseRpcUrl()}`);
    const initialBound = await loadProfile(profileHash);
    assertCoinbaseProfile(initialBound);
    return await state.withLocks([`profile:${profileHash}`, `provider-account:${initialBound.provider_id}:${initialBound.account_binding_hash}`,
        `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
        const bound = await loadProfile(profileHash);
        assertCoinbaseProfile(bound);
        if (bound.account_binding_hash !== initialBound.account_binding_hash ||
            bound.public_address.toLowerCase() !== initialBound.public_address.toLowerCase()) {
            throw new ApnError("APN_PROFILE_DRIFT", "Coinbase account identity changed while acquiring its operation lock.");
        }
        if (bound.public_address.toLowerCase() === recipient.toLowerCase()) {
            throw new ApnError("APN_INVALID_INPUT", "Coinbase gasless sender and recipient must differ.");
        }
        const materialRequest = { method: "gasless.transfer", profile, providerId: bound.provider_id,
            profileRevision: bound.revision, capabilityHash: bound.capability_hash, accountBindingHash: bound.account_binding_hash,
            chainId: CHAIN_ID, token: BASE_USDC, sender: bound.public_address, recipient, grossAtomic: gross.toString(),
            netAtomic: gross.toString(), feeAtomic: "0", maxFeeAtomic: maximumFee.toString(), minReceivedAtomic: minimum.toString(),
            senderNativeDebitWei: "0", sponsorship: "coinbase_cdp_paymaster", rpcBindingHash };
        const requestHash = hashObject(materialRequest);
        const existing = await operations.resolvePrepare({ kind: "direct_transfer", profileHash, operationId, idempotencyHash, requestHash });
        if (existing !== null)
            return publicOperation(existing.record);
        await operations.assertEvmAccountAvailable(profileHash, CHAIN_ID, bound.public_address);
        await operations.assertProviderAccountAvailable(bound.provider_id, bound.account_binding_hash, bound.public_address);
        const snapshot = await coinbaseGaslessSnapshot(context.requireCoinbaseRpc(), bound.public_address);
        if (BigInt(snapshot.balanceAtomic) < gross)
            throw new ApnError("APN_INSUFFICIENT_USDC", "USDC balance is insufficient for the gross transfer.");
        const preparedAt = new Date(Math.floor(context.clock.now().getTime() / 1000) * 1000);
        const expiresAt = new Date(preparedAt.getTime() + APPROVAL_WINDOW_MS);
        const providerDirect = { schemaVersion: "apn.provider-direct.v1", providerId: bound.provider_id,
            profileRevision: bound.revision, capabilityHash: bound.capability_hash, accountBindingHash: bound.account_binding_hash,
            rpcBindingHash, rpcOriginHash: sha256(`direct-rpc-origin\0${snapshot.rpcOrigin}`), policy: DIRECT_POLICY,
            executionMode: "provider_atomic_send", executionOwner: "provider", retryOwner: "apn_outer_no_replay_journal",
            coinbaseGasless: { schemaVersion: "apn.coinbase-gasless.v1", chainId: CHAIN_ID, token: BASE_USDC,
                grossAtomic: gross.toString(), netAtomic: gross.toString(), feeAtomic: "0", maxFeeAtomic: maximumFee.toString(),
                minReceivedAtomic: minimum.toString(), senderNativeDebitWei: "0", sponsorship: "coinbase_cdp_paymaster",
                exclusiveAccountUseRequired: true, awalPackage: "awal", awalVersion: "2.12.1", awalCommand: "send_base_usdc",
                rpcOrigin: snapshot.rpcOrigin, safeBlock: snapshot.safeBlock, entryPoint: COINBASE_ENTRY_POINT,
                entryPointCodeHash: snapshot.entryPointCodeHash, accountCodeHash: snapshot.accountCodeHash,
                accountImplementation: snapshot.accountImplementation, accountImplementationCodeHash: snapshot.accountImplementationCodeHash } };
        const fingerprint = hashObject({ ...materialRequest, operationId, idempotencyHash, providerDirect });
        const initial = { at: preparedAt.toISOString(), state: "awaiting_approval", terminal: false,
            reason: "prepared_coinbase_gasless_provider_atomic_send", proofClass: "durable_coinbase_gasless_intent" };
        const operation = sealOperation({ schemaVersion: STATE_VERSION, operationId, idempotencyHash, profile, profileHash,
            requestHash, fingerprint, walletAddress: bound.public_address, recipient, amountAtomic: gross.toString(),
            amountDecimal: formatAtomic(gross.toString(), USDC_DECIMALS), chainId: CHAIN_ID, token: BASE_USDC, providerDirect,
            coinbaseGaslessCursor: { nextBlockAtomic: (BigInt(snapshot.safeBlock.numberAtomic) + 1n).toString(), previousEndBlock: null },
            preparedAt: preparedAt.toISOString(), expiresAt: expiresAt.toISOString(), state: initial.state, terminal: false,
            reason: initial.reason, proofClass: initial.proofClass, transitions: appendTransition([], initial) });
        await durable.persist(operation);
        return publicOperation(operation);
    });
}
export async function coinbaseGaslessPreconditionsMatch(context, operation) {
    const frozen = operation.providerDirect?.coinbaseGasless;
    if (frozen === undefined)
        return true;
    const snapshot = await coinbaseGaslessSnapshot(context.requireCoinbaseRpc(), operation.walletAddress);
    return snapshot.rpcOrigin === frozen.rpcOrigin && snapshot.entryPointCodeHash === frozen.entryPointCodeHash &&
        snapshot.accountCodeHash === frozen.accountCodeHash && snapshot.accountImplementation === frozen.accountImplementation &&
        snapshot.accountImplementationCodeHash === frozen.accountImplementationCodeHash &&
        BigInt(snapshot.balanceAtomic) >= BigInt(operation.amountAtomic);
}
export async function reobserveCoinbaseGasless(context, durable, operation) {
    const observed = await observeCoinbaseGasless(context.requireCoinbaseRpc(), operation);
    if (observed.status === "safe")
        return await durable.transition(operation, "completed", true, "confirmed_coinbase_gasless_transfer", "canonical_safe_coinbase_gasless_settlement", { transactionHash: observed.settlement.transactionHash, coinbaseGaslessCursor: observed.cursor,
            coinbaseGaslessSettlement: observed.settlement });
    if (observed.status === "not_found" || observed.status === "pending")
        return await durable.transition(operation, "ambiguous_effect", false, observed.reason, "provider_effect_no_replay", { coinbaseGaslessCursor: observed.cursor });
    if (operation.state === "ambiguous_effect")
        return operation;
    return await durable.transition(operation, "ambiguous_effect", false, observed.reason, "provider_effect_no_replay");
}
function assertCoinbaseProfile(profile) {
    if (profile.provider_id !== "coinbase-agentic-wallet" || profile.capability_snapshot.direct.mode !== "provider_atomic_send") {
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The profile is not a bound Coinbase Agentic Wallet Base account.");
    }
}
//# sourceMappingURL=coinbase-gasless-provider.js.map