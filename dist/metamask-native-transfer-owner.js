import { nativeContextDeadline, validateMetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { takeMetaMaskNativeProcessFailureDiagnostic } from "./metamask-process-runner.js";
import { OperationService } from "./operation-service.js";
import { admitOperation } from "./operation-index/admission.js";
import { evmClaim } from "./operation-index/adapters/family-claims.js";
import { evmAddressLock } from "./evm-address-ownership.js";
import { listLocalWallets, listEncryptedWalletEnvelopes } from "./wallet-import-collision.js";
import { walletEnvelopeIdentity } from "./encrypted-wallet-store.js";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { allowlistProfileHash } from "./allowlist-policy-overlay.js";
import { assertRecipientAdmitted, canonicalRecipient } from "./allowlist-recipient-pins.js";
import { isatty } from "node:tty";
import { getAddress } from "viem";
import { hashObject, canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { StateStore } from "./state.js";
import { AssetUsageLedger } from "./asset-usage-ledger.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { canonicalProfile } from "./wallet-policy.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { exactChainConsent } from "./tty-approval.js";
import { approvalCode } from "./approval-code.js";
import { evmUint } from "./evm-asset.js";
import { formatAtomic } from "./money.js";
import { METAMASK_NATIVE_CHAINS, metaMaskNativeQuoteTransfer, metaMaskNativeUsdc, validateMetaMaskNativeFeeQuote, validateMetaMaskNativeFeeReceipt } from "./metamask-native-fee-evidence.js";
import { MetaMaskNativeHandoffNotStarted, readMetaMaskNativeVendorPolicy, readMetaMaskNativeRequest, readMetaMaskNativeSdkRequest, submitOwnedMetaMaskNative } from "./metamask-native-transfer-adapter.js";
import { prepareMetaMaskNativeQuote, readMetaMaskNativeFunding, observeMetaMaskNativeTransfer } from "./metamask-native-transfer-rpc.js";
import { MetaMaskNativeJournal, METAMASK_NATIVE_OPERATION_SCHEMA, METAMASK_NATIVE_SDK_HANDOFF, loadMetaMaskNativeOwner, metaMaskNativeExpiredBeforeEffect, metaMaskNativeRequestHash, metaMaskNativeHasRequest, metaMaskNativeObserveCommand, metaMaskNativeRequestIdHash, metaMaskNativeRequestLabel, metaMaskNativeRequestMatches, patchMetaMaskNativeOperation as patch, publicMetaMaskNativeOperation as publicOperation } from "./metamask-native-journal.js";
import { metaMaskNativeHandoffFields, metaMaskNativeReadEvidence, metaMaskNativeRequestTask, openMetaMaskNativeRequest, publicMetaMaskNativeReadObservation, sealMetaMaskNativeRequest } from "./metamask-native-request-reference.js";
import { assetUsageReservationId } from "./asset-usage-ledger.js";
import { refreshOperationIndex } from "./operation-index/refresh.js";
/** Journal readers, also reachable here for callers that name the command module. */
export { readMetaMaskNativeSettlement, readMetaMaskNativeReservation, assertMetaMaskNativeFailedBeforeEffect, assertMetaMaskNativeGenericCapacityRelease, metaMaskNativeOperationExists } from "./metamask-native-journal.js";
const scopes = new WeakMap();
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function entry(scope, context) {
    const e = scope !== null && typeof scope === "object" ? scopes.get(scope) : undefined;
    const now = new Date();
    if (e === undefined || e.context !== context || !e.lockActive || e.state === "invalid" || performance.now() >= e.monotonicDeadline || now.getTime() < e.lastNow ||
        now.toISOString().slice(0, 10) !== context.issuedDay || now.getTime() >= Date.parse(context.consentExpiresAt) ||
        now.getTime() >= Date.parse(context.quote.expiresAt))
        blocked("Native transfer owner scope is absent, changed or expired.");
    e.lastNow = now.getTime();
    return e;
}
/** Claim is deliberately synchronous: no second SDK action can claim the same foreground consent. */
export function claimMetaMaskNativeOwnedScope(scope, context) {
    const e = entry(scope, context);
    if (e.state !== "issued")
        blocked("Native transfer consent has already been consumed.");
    e.state = "consuming";
}
export function assertMetaMaskNativeOwnedScope(scope, context) {
    const e = entry(scope, context);
    if (e.state !== "consuming")
        blocked("Native transfer scope has not been claimed.");
    return Object.freeze({ utcExpiresAt: nativeContextDeadline(context), monotonicDeadlineMs: e.monotonicDeadline });
}
/** The provider request id the claimed scope's effect marker names by its hash: only the claimed hand-off sends it. */
export function metaMaskNativeOwnedRequestId(scope, context) {
    assertMetaMaskNativeOwnedScope(scope, context);
    return entry(scope, context).requestId;
}
/** The last guard before the hand-off, never a caller supplied callback: local custody, the vendor Guard policy, funds and nonce. */
export async function assertMetaMaskNativeOwnedContextCurrent(scope, context) {
    const deadline = assertMetaMaskNativeOwnedScope(scope, context);
    const e = entry(scope, context), quote = context.quote, transfer = metaMaskNativeQuoteTransfer(quote);
    e.guardStage = "owner_guard";
    await assertCurrentLocal(scope, context);
    e.guardStage = "sdk_read";
    const vendor = await readMetaMaskNativeVendorPolicy(quote.chainId, quote.sender, transfer.recipient, deadline, context.profile);
    assertMetaMaskNativeOwnedScope(scope, context);
    if (vendor.vendorPolicyHash !== context.vendorPolicyHash || vendor.vendorProjectHash !== context.vendorProjectHash || vendor.tradingMode !== "guard" || vendor.selectedAddress.toLowerCase() !== quote.sender.toLowerCase())
        blocked("Native transfer current vendor project or Guard policy changed.");
    e.guardStage = "rpc_balance";
    const { balances, nonceAtomic } = await readMetaMaskNativeFunding(quote.chainId, quote.sender, deadline);
    assertMetaMaskNativeOwnedScope(scope, context);
    if (!fundsCover(balances, quote, transfer.amountAtomic) || nonceAtomic !== quote.transaction.nonceAtomic)
        blocked("Native transfer current physical balance or nonce changed.");
    e.guardStage = "owner_guard";
    await assertCurrentLocal(scope, context);
    assertMetaMaskNativeOwnedScope(scope, context);
}
function fundsCover(b, quote, amountAtomic) {
    return b.address.toLowerCase() === quote.sender.toLowerCase() && b.asset.chainId === quote.chainId && b.asset.address === quote.token && b.asset.kind === "erc20" && b.asset.decimals === 6 && b.blockHash !== undefined &&
        BigInt(b.nativeAtomic) >= BigInt(quote.feeQuote.totalQuoteWei) && BigInt(b.assetAtomic) >= BigInt(amountAtomic) && Date.now() - Date.parse(b.observedAt) <= 30_000 && Date.parse(b.observedAt) <= Date.now();
}
async function assertCurrentLocal(scope, context) {
    assertMetaMaskNativeOwnedScope(scope, context);
    const e = entry(scope, context), state = new StateStore(e.root), transfer = metaMaskNativeQuoteTransfer(context.quote);
    const current = await loadMetaMaskNativeOwner(state, context.profile);
    assertMetaMaskNativeOwnedScope(scope, context);
    await assertAccountAvailable(state, e.journal, context.quote.chainId, context.profile, context.quote.sender.toLowerCase(), context.operationId);
    assertMetaMaskNativeOwnedScope(scope, context);
    if (current.profile.public_address.toLowerCase() !== context.quote.sender.toLowerCase() || current.profile.account_binding_hash !== context.accountBindingHash || current.profile.capability_hash !== context.capabilityHash ||
        current.profile.revision !== context.profileRevision || current.policy.digest !== context.policyDigest ||
        current.policy.revision !== context.policyRevision || current.policy.activationDigest !== context.activationDigest)
        blocked("Native transfer current owner policy or custody changed.");
    const op = await e.journal.read(context.operationId);
    assertMetaMaskNativeOwnedScope(scope, context);
    if (op === null || op.state !== "effect_started" || op.effectAttempts !== 1 || canonicalJson(op.context) !== canonicalJson(context) ||
        op.handoffPath !== METAMASK_NATIVE_SDK_HANDOFF || op.providerRequestIdHash !== metaMaskNativeRequestIdHash(e.requestId))
        blocked("Native transfer durable effect marker changed.");
    const ledger = new AssetUsageLedger(e.root);
    for (const expected of e.reservations) {
        const held = await ledger.usageWithReservation(expected, expected.reservationId, new Date());
        assertMetaMaskNativeOwnedScope(scope, context);
        if (held.reservation === null || !["reserved", "submitted"].includes(held.reservation.state) || held.reservation.policyDigest !== context.policyDigest ||
            held.reservation.amountAtomic !== expected.amountAtomic || held.reservation.idempotencyHash !== expected.idempotencyHash)
            blocked("Native transfer finite usage hold changed.");
        const admission = evaluateAssetPolicy(current.policy.registry, { chain: expected.chain, asset: expected.asset, rail: "direct", amountAtomic: expected.amountAtomic,
            dailyUsageAtomic: (BigInt(held.snapshot.amountAtomic) - BigInt(expected.amountAtomic)).toString(), asOfDate: context.issuedDay, asOf: new Date().toISOString() });
        // First send: the owner's recipient pin (OD-1) still admits this operation's own recipient.
        if (expected.asset.kind === "token")
            assertRecipientAdmitted({ admission, recipient: transfer.recipient });
    }
    assertMetaMaskNativeOwnedScope(scope, context);
}
/**
 * Every profile that names this physical account (aliases share conflict checks, not an exclusivity ban) must have no
 * unresolved EVM operation on this chain, and no other native transfer of the account and chain may be unresolved.
 * `exceptId` is this operation's own id: only its claimed owner, holding the account locks, passes it.
 */
async function assertAccountAvailable(state, journal, chainId, profileName, account, exceptId) {
    const hashes = new Set([state.profileHash(profileName)]), payer = account.toLowerCase();
    for (const item of await state.profileImportEntries()) {
        if (!item.isDirectory() || item.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(item.name))
            throw new ApnError("APN_STATE_CORRUPT", "Profiles directory is invalid during native account conflict check.");
        const profile = await state.loadProviderProfile(item.name);
        if (profile === null)
            throw new ApnError("APN_STATE_CORRUPT", "Provider profile disappeared during native account conflict check.");
        if (profile.public_address.toLowerCase() === payer)
            hashes.add(item.name);
    }
    for (const wallet of await listLocalWallets(state))
        if (wallet.address.toLowerCase() === payer)
            hashes.add(wallet.profileHash);
    for (const envelope of await listEncryptedWalletEnvelopes(state)) {
        const identity = walletEnvelopeIdentity(envelope.value, envelope.profile);
        if (identity.address.toLowerCase() === payer)
            hashes.add(state.profileHash(identity.profile));
    }
    for (const operation of await state.listAllOperations())
        if (operation.walletAddress.toLowerCase() === payer)
            hashes.add(operation.profileHash);
    const operations = new OperationService(state);
    for (const hash of hashes)
        await operations.assertEvmAccountAvailableExcept(hash, chainId, payer, exceptId);
    await journal.assertAccountAvailable(chainId, payer, exceptId);
}
function freeze(value) { if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value))
        freeze(child);
} return value; }
function chain(input) {
    if (!METAMASK_NATIVE_CHAINS.includes(input))
        throw new ApnError("APN_INVALID_INPUT", "MetaMask native transfers run on Ethereum, Optimism, Monad, Linea and Sei only.");
    return input;
}
function recipientInput(value) {
    const canonical = canonicalRecipient(value);
    if (canonical === null || canonical.family !== "evm")
        throw new ApnError("APN_INVALID_INPUT", "The recipient must be a non-zero EVM address.");
    return canonical.address;
}
function amountInput(value) {
    if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/u.test(value))
        throw new ApnError("APN_INVALID_INPUT", "The amount must be a positive whole number of USDC atomic units.");
    return evmUint(value, true).toString();
}
/** One foreground command: admission, vendor Guard check, quote, consent, the single hand-off and its durable outcome. */
/** A quote above the owner's native ceiling names both limits that ceiling came from, and where the owner reviews them. */
export function withNativeFeeCeiling(error, caps, profile) {
    if (!(error instanceof ApnError) || error.details?.reason !== "native_fee_quote_above_owner_cap")
        return error;
    return new ApnError(error.code, error.message, { ...error.details, per_transfer_cap_wei: caps.perTransferWei,
        daily_remaining_wei: caps.dailyRemainingWei, nextActions: [`apn allowlist policy status --profile ${profile}`] });
}
/** `references` seals the MetaMask request id APN gives the hand-off; its wrapping secret is read before consent. */
export async function runMetaMaskNativeTransfer(stateRoot, input, references) {
    const profileName = canonicalProfile(input.profile), chainId = chain(input.chainId), key = canonicalIdempotencyKey(input.idempotencyKey);
    const recipient = recipientInput(input.recipient), amountAtomic = amountInput(input.amountAtomic), state = new StateStore(stateRoot), journal = new MetaMaskNativeJournal(stateRoot);
    const id = state.operationId(profileName, `metamask-native:${chainId}:${key}`), request = { chainId, key, profile: profileName, recipient, amountAtomic }, requestHash = metaMaskNativeRequestHash(request);
    const replay = (existing) => { if (!metaMaskNativeRequestMatches(existing, request))
        blocked("Native transfer idempotency collision."); return publicOperation(existing); };
    await journal.initialize();
    const saved = await state.withLocks([`operation:${id}`], async () => await journal.read(id));
    if (saved !== null)
        return replay(saved);
    const initial = await state.withLocks([`profile:${allowlistProfileHash(profileName)}`, `profile:${state.profileHash(profileName)}`], () => loadMetaMaskNativeOwner(state, profileName));
    const payer = initial.profile.public_address.toLowerCase();
    await closeExpiredNativeTransfersOf(stateRoot, chainId, payer);
    // The operation lock is held from before the effect marker until the hand-off's outcome and holds are recorded:
    // readMetaMaskNativeTransfer relies on it (recordInterruptedHandoff).
    return state.withLocks([`profile:${allowlistProfileHash(profileName)}`, `profile:${state.profileHash(profileName)}`, `operation:${id}`, "provider-session:metamask-agent-wallet", evmAddressLock(payer), `account-chain-nonce:${payer}:${chainId}`], async () => {
        const existing = await journal.read(id);
        if (existing !== null)
            return replay(existing);
        // The account claim is written before any vendor, RPC or ledger read: every family's prepare on this account and chain
        // waits for it from here, and this transfer waits for theirs.
        return await admitOperation(state, { family: "metamask_native", profileHash: state.profileHash(profileName), operationId: id,
            idempotencyHash: null, requestHash }, [evmClaim(chainId, payer)], async () => {
            await assertAccountAvailable(state, journal, chainId, profileName, payer, id);
            const owner = await loadMetaMaskNativeOwner(state, profileName), ledger = new AssetUsageLedger(stateRoot), now = new Date(), day = now.toISOString().slice(0, 10);
            if (owner.profile.public_address.toLowerCase() !== payer || owner.profile.account_binding_hash !== initial.profile.account_binding_hash || owner.profile.revision !== initial.profile.revision)
                blocked("MetaMask profile changed before acquiring custody locks.");
            const sender = getAddress(payer), chainName = `eip155:${chainId}`, tokenAsset = { kind: "token", identifier: metaMaskNativeUsdc(chainId) };
            // Direct-rail admission of the exact amount and the owner's recipient pin (OD-1) come before any vendor or RPC read.
            const tokenAdmission = evaluateAssetPolicy(owner.policy.registry, { chain: chainName, asset: tokenAsset, rail: "direct", amountAtomic,
                dailyUsageAtomic: (await ledger.usage({ account: sender, chain: chainName, asset: tokenAsset }, now)).amountAtomic, asOfDate: day, asOf: now.toISOString() });
            assertRecipientAdmitted({ admission: tokenAdmission, recipient });
            const identity = { account: sender, chain: chainName, asset: { kind: "native", identifier: null } };
            const usage = await ledger.usage(identity, now);
            const admission = evaluateAssetPolicy(owner.policy.registry, { chain: identity.chain, asset: identity.asset, rail: "direct", amountAtomic: "1", dailyUsageAtomic: usage.amountAtomic, asOfDate: day, asOf: now.toISOString() });
            const cap = BigInt(admission.caps.maximumPerTransferAtomic) < BigInt(admission.dailyRemainingAtomic) ? admission.caps.maximumPerTransferAtomic : admission.dailyRemainingAtomic;
            const vendor = await readMetaMaskNativeVendorPolicy(chainId, sender, recipient, undefined, profileName);
            if (vendor.selectedAddress.toLowerCase() !== payer || vendor.tradingMode !== "guard" || !/^[a-f0-9]{64}$/.test(vendor.vendorProjectHash))
                blocked("MetaMask vendor wallet or Guard mode differs from the paying profile.");
            const prepared = await prepareMetaMaskNativeQuote({ chainId, maximumNativeFeeWei: cap, sender, recipient, amountAtomic }).catch((error) => {
                throw withNativeFeeCeiling(error, { perTransferWei: admission.caps.maximumPerTransferAtomic, dailyRemainingWei: admission.dailyRemainingAtomic }, profileName);
            });
            const quote = freeze(structuredClone(validateMetaMaskNativeFeeQuote(prepared.quote, new Date()))), transfer = metaMaskNativeQuoteTransfer(quote);
            if (quote.sender.toLowerCase() !== payer || quote.nativeFeeCapAtomic !== cap || transfer.recipient !== recipient || transfer.amountAtomic !== amountAtomic)
                blocked("MetaMask native quote differs from the requested transfer or the current policy ceiling.");
            if (!fundsCover(prepared.funding.balances, quote, amountAtomic))
                blocked("MetaMask physical native/USDC balance is insufficient or stale.");
            const expires = new Date(Math.min(Date.now() + 60_000, Date.parse(quote.expiresAt))).toISOString();
            const context = freeze({ profile: profileName, profileHash: owner.profile.profile_hash, accountBindingHash: owner.profile.account_binding_hash,
                capabilityHash: owner.profile.capability_hash, profileRevision: owner.profile.revision, policyDigest: owner.policy.digest, policyRevision: owner.policy.revision,
                activationDigest: owner.policy.activationDigest, vendorPolicyHash: vendor.vendorPolicyHash, vendorProjectHash: vendor.vendorProjectHash, quote, operationId: id, consentExpiresAt: expires, issuedDay: day });
            const reservations = [];
            let op, scope;
            try {
                op = await journal.persist({ schemaVersion: METAMASK_NATIVE_OPERATION_SCHEMA, operationId: id, requestHash, context, reservations: [], state: "prepared", effectAttempts: 0,
                    transactionHash: null, providerRequestId: null, receiptEvidence: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
                for (const kind of ["native", "token"])
                    reservations.push(await ledger.reserveMetaMaskNative(id, kind, new Date()));
                if (reservations.some(r => r.state !== "reserved"))
                    blocked("Native transfer usage replay cannot invoke a private effect.");
                op = await journal.persist(patch(op, { reservations }));
                if (process.stdin.isTTY !== true || process.stderr.isTTY !== true || !isatty(0) || !isatty(2))
                    blocked("A genuine foreground stdin/stderr terminal is required.");
                // The request id is sealed after consent: a wrapping secret that cannot be read refuses here, before consent.
                await references.ready();
                const limits = Object.entries(vendor.outflowLimitsUsd).map(([name, value]) => `${name} ${value} USD`).join(", ");
                await exactChainConsent(["Agent Payment Node — MetaMask Agent Wallet USDC transfer, network fee paid in the native coin", `Profile: ${context.profile}; sender: ${quote.sender}`,
                    `Chain: eip155:${chainId}; token: ${quote.token}`, `Recipient: ${recipient}`, `Amount: ${amountAtomic} atomic USDC (${formatAtomic(amountAtomic, 6)} USDC)`,
                    `Maximum FULL native fee: ${quote.feeQuote.totalQuoteWei} atomic`, `MetaMask Guard: recipient allowlisted on eip155:${chainId}; outflow limit ${limits}`,
                    `Quote: ${quote.quoteHash}`, `Operation: ${id}`], approvalCode("transfer", id, quote.quoteHash), expires, {});
                if (new Date().toISOString().slice(0, 10) !== day || Date.now() >= Date.parse(expires))
                    blocked("Native transfer consent expired.");
                const fresh = await loadMetaMaskNativeOwner(state, profileName);
                if (fresh.policy.activationDigest !== owner.policy.activationDigest || fresh.profile.revision !== owner.profile.revision || fresh.profile.account_binding_hash !== owner.profile.account_binding_hash)
                    blocked("Native transfer owner changed during consent.");
                await assertAccountAvailable(state, journal, chainId, profileName, payer, id);
                if (Date.now() >= Date.parse(expires) || new Date().toISOString().slice(0, 10) !== day)
                    blocked("Native transfer consent expired during account conflict recheck.");
                // APN names the MetaMask request itself (a v4 UUID, the form the SDK would generate). The id is sealed, and the
                // effect marker names its hash and the helper path, before the helper that sends it can start: a seal or marker
                // that fails leaves the transfer prepared, and it closes below as failed before effect with nothing sent. From
                // the marker on, every outcome keeps the id, so observe reads that very request from MetaMask's server.
                const requestId = randomUUID(), requestIdHash = await sealMetaMaskNativeRequest(references, op, requestId);
                op = await journal.persist(patch(op, { state: "effect_started", effectAttempts: 1, providerRequestIdHash: requestIdHash, handoffPath: METAMASK_NATIVE_SDK_HANDOFF }));
                scope = Object.freeze({});
                scopes.set(scope, { root: stateRoot, context, journal, reservations, requestId, state: "issued", lockActive: true, monotonicDeadline: performance.now() + Math.min(60000, Date.parse(expires) - Date.now()), lastNow: Date.now(), guardStage: "owner_guard", startedAt: performance.now() });
                const result = await submitOwnedMetaMaskNative(scope, context);
                op = await journal.persist(patch(op, metaMaskNativeHandoffFields(result, requestIdHash)));
                for (const r of reservations)
                    await ledger.transition({ ...transitionIdentity(r), state: result.disposition === "acknowledged" ? "submitted" : "unknown_finality", now: new Date() });
                return publicOperation(op);
            }
            catch (error) {
                if (op !== undefined) {
                    if (op.effectAttempts === 1 && op.state === "effect_started" && error instanceof MetaMaskNativeHandoffNotStarted) {
                        // Proven no handoff: the helper never started, so the marker closes as failed before effect.
                        op = await journal.persist(patch(op, { state: "failed_before_effect" }));
                        for (const r of reservations)
                            await ledger.transition({ ...transitionIdentity(r), state: "failed_before_effect", now: new Date(), outcomeDigest: hashObject({ id, kind: "failed_before_effect" }), expectedCurrentStates: ["reserved"] });
                        throw error.causeError;
                    }
                    if (op.effectAttempts === 1) {
                        if (op.state === "effect_started")
                            op = await journal.persist(patch(op, { state: "unknown", diagnostic: failureDiagnostic(error, context, scope) }));
                        for (const r of reservations)
                            await ledger.transition({ ...transitionIdentity(r), state: "unknown_finality", now: new Date() });
                        return publicOperation(op);
                    }
                    op = await journal.persist(patch(op, { state: "failed_before_effect", reservations }));
                }
                for (const r of reservations)
                    await ledger.transition({ ...transitionIdentity(r), state: "failed_before_effect", now: new Date(), outcomeDigest: hashObject({ id, kind: "failed_before_effect" }), expectedCurrentStates: ["reserved"] });
                throw error;
            }
            finally {
                if (scope !== undefined) {
                    const e = scopes.get(scope);
                    if (e !== undefined) {
                        e.state = "invalid";
                        e.lockActive = false;
                    }
                    scopes.delete(scope);
                }
            }
        });
    });
}
function transitionIdentity(r) { return { account: r.account, chain: r.chain, asset: r.asset, reservationId: r.reservationId, policyDigest: r.policyDigest }; }
/**
 * R4: a transfer whose foreground command ended before its effect marker (still `prepared`, nothing handed off or signed)
 * and whose consent has passed can never start. It closes as failed before effect, as that command itself closes a
 * transfer whose consent ran out, and the usage it held is released. The caller holds the operation lock.
 */
async function closeExpiredBeforeEffect(stateRoot, journal, op, now) {
    if (!metaMaskNativeExpiredBeforeEffect(op, now.getTime()))
        return op;
    const closed = await journal.persist(patch(op, { state: "failed_before_effect" }));
    await releaseHoldsFailedBeforeEffect(stateRoot, closed, now);
    return closed;
}
/**
 * A transfer that failed before its effect releases its usage holds, as the send (or the expiry close above) does right
 * after it records `failed_before_effect`. A command that ended between the two left holds `reserved` that count against
 * the daily limit forever. Under the operation lock this releases exactly those: only a journal `failed_before_effect`
 * with no transaction hash, which APN writes only with nothing handed off: from `prepared` (effect attempts 0), or from a
 * marker whose hand-off provably never started (effect attempts 1, the send's `MetaMaskNativeHandoffNotStarted` path;
 * the journal admits no other attempt count for this state). Only the two rows of this very operation (their ids derive
 * from it, so a crash before the journal named them is covered too), only from `reserved`, with the operation's quote,
 * policy and amounts, and with the send's own outcome digest. Any other row is left as it is.
 */
async function releaseHoldsFailedBeforeEffect(stateRoot, op, now) {
    if (op.state !== "failed_before_effect" || op.transactionHash !== null)
        return;
    const ledger = new AssetUsageLedger(stateRoot), q = op.context.quote, transfer = metaMaskNativeQuoteTransfer(q);
    for (const [asset, amountAtomic] of [[{ kind: "native", identifier: null }, q.feeQuote.totalQuoteWei], [{ kind: "token", identifier: q.token }, transfer.amountAtomic]]) {
        const identity = { account: q.sender, chain: `eip155:${q.chainId}`, asset }, reservationId = assetUsageReservationId(identity, `apn.metamask-native:${op.operationId}:${asset.kind}`);
        const held = await ledger.load(identity, reservationId), stored = op.reservations.find(r => r.reservationId === reservationId);
        if (held === null || held.state !== "reserved" || held.metamaskNativeReservation?.operationId !== op.operationId || held.metamaskNativeReservation.quoteHash !== q.quoteHash ||
            held.policyDigest !== op.context.policyDigest || held.amountAtomic !== amountAtomic || stored !== undefined && held.idempotencyHash !== stored.idempotencyHash)
            continue;
        await ledger.transition({ ...transitionIdentity(held), state: "failed_before_effect", now, outcomeDigest: hashObject({ id: op.operationId, kind: "failed_before_effect" }),
            expectedCurrentStates: ["reserved"] });
    }
}
/**
 * This read verified that MetaMask closed the very request at its approval step (`EXPIRED` or `DENIED`, which `mm`
 * itself reads as an MFA rejection before signing) and no transaction is known: the provider's word, not chain evidence.
 * The transfer stays UNKNOWN with its reserves charged; the next actions name the owner's only exit, abandonment after
 * the quote expired, which frees the account and keeps the reserves until the chain proves an outcome.
 */
export function metaMaskNativeClosedRequestNextActions(op, read) {
    if (read === undefined || read.request_identity_verified !== true || (read.provider_status !== "EXPIRED" && read.provider_status !== "DENIED") ||
        op.state !== "unknown" || op.transactionHash !== null)
        return undefined;
    return [`MetaMask closed ${metaMaskNativeRequestLabel(op)} as ${read.provider_status} at its approval step, before signing. That is the provider's word, not chain evidence: do not confirm the old request; APN keeps this transfer UNKNOWN, keeps its reserves charged and never sends it again.`,
        metaMaskNativeObserveCommand(op.operationId),
        `To free the account for a new transfer, from ${op.context.quote.expiresAt} on: apn operation abandon --operation ${op.operationId} (the reserves stay charged until the chain proves an outcome).`];
}
/**
 * Before a new transfer is admitted, every transfer of this account and chain that can never start is closed under its
 * own operation lock. Best effort: one that cannot be closed now no longer blocks (the family's own rule reads it as
 * resolved), and its next status closes it.
 */
export async function closeExpiredNativeTransfersOf(stateRoot, chainId, payer) {
    const journal = new MetaMaskNativeJournal(stateRoot);
    for (const stale of (await journal.forAccount(chainId, payer)).filter(op => metaMaskNativeExpiredBeforeEffect(op))) {
        try {
            await journal.withLocks([`operation:${stale.operationId}`], async () => { const op = await journal.read(stale.operationId); if (op !== null)
                await closeExpiredBeforeEffect(stateRoot, journal, op, new Date()); });
            await refreshOperationIndex(journal, stale.operationId);
        }
        catch { /* The next status closes it; meanwhile it no longer blocks. */ }
    }
}
/**
 * A helper hand-off whose sending command ended at its effect marker (`effect_started`). The send holds this operation's
 * lock from before the marker until it has recorded the outcome and moved the holds, so a reader that holds the lock and
 * still finds the marker knows that command is gone, whatever it did. Its outcome is UNKNOWN, as the send's own failure
 * path records it, before any read can add a hash, a receipt or a task: every hold still `reserved` moves to
 * `unknown_finality` first (a crash between the two leaves the marker, and this runs again), then the journal says why.
 * A record without the helper path (0.5.107 and earlier) is left exactly as it is.
 */
async function recordInterruptedHandoff(stateRoot, journal, op) {
    if (op.state !== "effect_started" || op.effectAttempts !== 1 || op.handoffPath !== METAMASK_NATIVE_SDK_HANDOFF)
        return op;
    const ledger = new AssetUsageLedger(stateRoot);
    // A hold already `submitted` (not what this send writes before its outcome) moves too and stays charged, rather than
    // making every later observe refuse.
    for (const r of op.reservations)
        await ledger.transition({ ...transitionIdentity(r), state: "unknown_finality", now: new Date(),
            expectedCurrentStates: ["reserved", "submitted", "unknown_finality"] });
    // Built at call time: this module sits in an import cycle with the adapter.
    const interrupted = validateMetaMaskNativeDiagnostic({ stage: "post_handoff", code: "interrupted", exitCode: null, signal: null, durationMs: 0, remainingMs: 0,
        stderrClass: "none", providerCode: "none" });
    return await journal.persist(patch(op, { state: "unknown", ...(op.diagnostic === undefined ? { diagnostic: interrupted } : {}) }));
}
/**
 * The send's own outcome paths persist the journal first and move the holds after it, in every release. A command that
 * ended between the two leaves a record past its effect marker (acknowledged or unknown, later confirmed or abandoned)
 * whose holds are still `reserved`, and its settlement would refuse forever ("no durable effect hold"). The caller holds
 * the operation lock, which the send holds for its whole run, so that command is gone: every hold of this operation still
 * `reserved` moves to the state the send would have written, `submitted` for an acknowledged outcome, else
 * `unknown_finality`. Both keep the hold charged: this never releases or finalizes money, and settlement still needs the
 * receipt. A hold already moved is left alone, and so is a missing or changed one (its settlement still refuses). No
 * journal field changes, so a record any release wrote gets the same repair, and running it again does nothing.
 */
async function moveHoldsLeftReserved(stateRoot, op) {
    if (op.effectAttempts !== 1 || ["prepared", "effect_started", "failed_before_effect"].includes(op.state))
        return;
    const ledger = new AssetUsageLedger(stateRoot), state = op.state === "acknowledged" ? "submitted" : "unknown_finality";
    for (const r of op.reservations) {
        const held = await ledger.load({ account: r.account, chain: r.chain, asset: r.asset }, r.reservationId);
        if (held === null || held.state !== "reserved" || held.metamaskNativeReservation?.operationId !== op.operationId || held.policyDigest !== r.policyDigest ||
            held.amountAtomic !== r.amountAtomic || held.idempotencyHash !== r.idempotencyHash)
            continue;
        await ledger.transition({ ...transitionIdentity(r), state, now: new Date(), expectedCurrentStates: ["reserved"] });
    }
}
function failureDiagnostic(error, context, scope) {
    const e = scope === undefined ? undefined : scopes.get(scope), deadline = Date.parse(nativeContextDeadline(context));
    return takeMetaMaskNativeProcessFailureDiagnostic(error) ?? (error instanceof ApnError && "nativeDiagnostic" in error ? validateMetaMaskNativeDiagnostic(error.nativeDiagnostic) : undefined) ?? validateMetaMaskNativeDiagnostic({
        stage: e?.guardStage ?? "owner_guard", code: Date.now() >= deadline || e !== undefined && performance.now() >= e.monotonicDeadline ? "deadline" : "refused", exitCode: null, signal: null,
        durationMs: Math.floor(e === undefined ? 0 : performance.now() - e.startedAt), remainingMs: Math.max(0, Math.min(60000, Math.floor(Math.min(deadline - Date.now(), e === undefined ? 60000 : e.monotonicDeadline - performance.now())))),
        stderrClass: "none", providerCode: "none"
    });
}
/**
 * Status, and with `observe` one no-send read of the stored request or transaction. Under the operation lock, before any
 * seal is opened, it first brings the record's own state up to date: it closes a transfer whose consent passed before its
 * marker, releases the holds of one that failed before its effect, with `observe` records a hand-off whose command ended
 * at its marker UNKNOWN, and moves holds a send left `reserved` after its outcome. Those writes stay even when the seal
 * then cannot be opened. A record that seals its request id opens it from `references` before any provider read; one
 * that cannot be opened refuses the read precisely, and nothing is read from the provider or written after that.
 */
export async function readMetaMaskNativeTransfer(stateRoot, idInput, observe = false, references) {
    const id = canonicalOperationId(idInput), journal = new MetaMaskNativeJournal(stateRoot);
    if (await journal.read(id) === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
    return journal.withLocks([`operation:${id}`], async () => {
        let op = await journal.read(id);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
        op = await closeExpiredBeforeEffect(stateRoot, journal, op, new Date());
        await releaseHoldsFailedBeforeEffect(stateRoot, op, new Date());
        // Observing, under the operation lock: a helper hand-off whose command ended at its marker is UNKNOWN first.
        if (observe)
            op = await recordInterruptedHandoff(stateRoot, journal, op);
        // Status and observe alike, before any receipt or settlement: a send that ended after its journal outcome and before
        // its hold transitions leaves holds `reserved`, which settlement would never accept.
        await moveHoldsLeftReserved(stateRoot, op);
        let readObservation = observe ? publicMetaMaskNativeReadObservation(Object.freeze({ stage: "not_requested", guard_step: null,
            request_id: op.providerRequestId, watch_returned: false, before_guard_verified: false, after_guard_verified: false,
            request_identity_verified: false, provider_status: null, transaction_hash: op.transactionHash, chain_id: op.context.quote.chainId,
            response_hash: null, reason: metaMaskNativeHasRequest(op) ? "stored_transaction_or_confirmed" : op.providerRequestReason ?? "no_stored_request_id", error_code: null, diagnostic: null }), op) : undefined;
        // A helper hand-off that never started (failed before effect after its marker) names a request that never left.
        if (observe && op.transactionHash === null && metaMaskNativeHasRequest(op) && op.effectAttempts === 1 && op.state !== "failed_before_effect") {
            const requestId = await openMetaMaskNativeRequest(references, op);
            // The transfer's own sender and chain bind the server read. A request APN sent itself (0.5.108 and later) is never
            // in mm's local request list and is read from MetaMask's server by its id; an earlier release's request is watched
            // first, and read from the server only should mm's list no longer hold it.
            const binding = { sender: op.context.quote.sender, chainId: op.context.quote.chainId };
            const hint = op.handoffPath === METAMASK_NATIVE_SDK_HANDOFF ? await readMetaMaskNativeSdkRequest(requestId, op.context.vendorProjectHash, binding)
                : await readMetaMaskNativeRequest(requestId, op.context.vendorProjectHash, binding);
            readObservation = hint.readObservation === undefined ? undefined : publicMetaMaskNativeReadObservation(hint.readObservation, op);
            if (hint.requestId !== undefined && hint.requestId !== requestId || hint.chainId !== undefined && hint.chainId !== op.context.quote.chainId)
                blocked("Native transfer stored provider request identity or chain changed.");
            const hash = "transactionHash" in hint ? hint.transactionHash : undefined, mfa = hint.disposition === "pending" ? hint.mfa : undefined;
            if (hash !== undefined)
                op = await journal.persist(patch(op, { state: "unknown", transactionHash: hash, mfaTask: undefined }));
            // A verified notice or AWAITING_MFA status for this very request: the owner's task, kept beside the UNKNOWN outcome.
            else if (mfa !== undefined && op.state === "unknown")
                op = await journal.persist(patch(op, { mfaTask: metaMaskNativeRequestTask(op, metaMaskNativeReadEvidence(op, mfa), "watch") }));
            // The provider's own record of this request shows it past the approval (signing, denied, expired...): no task is left.
            else if (op.mfaTask !== undefined && op.state === "unknown" && hint.readObservation?.request_identity_verified === true)
                op = await journal.persist(patch(op, { mfaTask: undefined }));
        }
        if (observe && op.transactionHash !== null && op.state !== "confirmed") {
            const result = await observeMetaMaskNativeTransfer(op.context.quote, op.transactionHash);
            if (result.kind === "accepted") {
                const verdict = validateMetaMaskNativeFeeReceipt(result.evidence, op.context.quote);
                if (verdict.transactionHash !== op.transactionHash || canonicalJson(verdict) !== canonicalJson(result.receipt))
                    blocked("Native transfer canonical receipt binding changed.");
                op = await journal.persist(patch(op, { state: "confirmed", receiptEvidence: result.evidence }));
            }
        }
        if (op.state === "confirmed")
            await new AssetUsageLedger(stateRoot).settleMetaMaskNativeActual(op.operationId, new Date());
        const view = publicOperation(op), closed = metaMaskNativeClosedRequestNextActions(op, readObservation);
        return { ...view, ...(closed === undefined ? {} : { next_actions: closed }), ...(readObservation === undefined ? {} : { read_observation: readObservation }) };
    });
}
/**
 * Owner release (R4) of a native transfer whose outcome stayed unknown after its quote expired. It observes once,
 * never sends, keeps the stored transaction hash or request id, and leaves the held usage consumed. A transfer that
 * never reached its effect marker and whose consent has passed is closed as failed before effect instead (no consent).
 */
export async function abandonMetaMaskNativeTransfer(stateRoot, idInput, approve, now, references) {
    const id = canonicalOperationId(idInput), journal = new MetaMaskNativeJournal(stateRoot);
    const initial = await journal.read(id);
    if (initial === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
    if (initial.state === "abandoned_unknown")
        return publicOperation(initial);
    // Nothing was handed off and its consent has passed: it closes as failed before effect, as its status closes it.
    if (metaMaskNativeExpiredBeforeEffect(initial, now().getTime()))
        return journal.withLocks([`operation:${id}`], async () => {
            const op = await journal.read(id);
            if (op === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
            return publicOperation(await closeExpiredBeforeEffect(stateRoot, journal, op, now()));
        });
    const eligible = (o) => ["effect_started", "acknowledged", "unknown"].includes(o.state) && now().getTime() >= Date.parse(o.context.quote.expiresAt);
    if (!eligible(initial))
        blocked("Only a native transfer with an unknown outcome can be abandoned, and only after its quote expired.");
    try {
        await readMetaMaskNativeTransfer(stateRoot, id, true, references);
    }
    catch { /* Observation is best effort; consent decides. */ }
    return journal.withLocks([`operation:${id}`], async () => {
        const op = await journal.read(id);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
        if (op.state === "confirmed" || op.state === "abandoned_unknown")
            return publicOperation(op);
        if (!eligible(op))
            blocked("Only a native transfer with an unknown outcome can be abandoned, and only after its quote expired.");
        const q = op.context.quote, transfer = metaMaskNativeQuoteTransfer(q);
        await approve({ operationId: id, fingerprint: op.requestHash, profile: op.context.profile, providerId: "metamask-agent-wallet", walletAddress: q.sender,
            recipient: transfer.recipient, amountAtomic: transfer.amountAtomic, amountDecimal: formatAtomic(transfer.amountAtomic, 6), chainLabel: `eip155:${q.chainId}`, assetLabel: `USDC (${q.token})`, unit: "USDC",
            outcomeNote: `Financial outcome: UNKNOWN. The MetaMask Guard may have signed and broadcast this transfer${op.transactionHash === null ? "." : `; its transaction ${op.transactionHash} may still land.`}` });
        return publicOperation(await journal.persist(patch(op, { state: "abandoned_unknown" })));
    });
}
//# sourceMappingURL=metamask-native-transfer-owner.js.map