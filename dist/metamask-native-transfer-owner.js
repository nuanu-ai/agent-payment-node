import { nativeContextDeadline, validateMetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { takeMetaMaskNativeProcessFailureDiagnostic } from "./metamask-process-runner.js";
import { OperationService } from "./operation-service.js";
import { evmAddressLock } from "./evm-address-ownership.js";
import { listLocalWallets, listEncryptedWalletEnvelopes } from "./wallet-import-collision.js";
import { walletEnvelopeIdentity } from "./encrypted-wallet-store.js";
import { performance } from "node:perf_hooks";
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
import { MetaMaskNativeHandoffNotStarted, readMetaMaskNativeVendorPolicy, readMetaMaskNativeRequest, submitOwnedMetaMaskNative } from "./metamask-native-transfer-adapter.js";
import { prepareMetaMaskNativeQuote, readMetaMaskNativeFunding, observeMetaMaskNativeTransfer } from "./metamask-native-transfer-rpc.js";
import { MetaMaskNativeJournal, METAMASK_NATIVE_OPERATION_SCHEMA, loadMetaMaskNativeOwner, metaMaskNativeRequestHash, metaMaskNativeRequestMatches, patchMetaMaskNativeOperation as patch, publicMetaMaskNativeOperation as publicOperation } from "./metamask-native-journal.js";
/** Journal readers, also reachable here for callers that name the command module. */
export { readMetaMaskNativeSettlement, readMetaMaskNativeReservation, assertMetaMaskNativeFailedBeforeEffect, assertMetaMaskNativeGenericCapacityRelease, assertMetaMaskNativeConflictDomainAvailable, metaMaskNativeOperationExists } from "./metamask-native-journal.js";
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
/** The last guard before the hand-off, never a caller supplied callback: local custody, the vendor Guard policy, funds and nonce. */
export async function assertMetaMaskNativeOwnedContextCurrent(scope, context) {
    const deadline = assertMetaMaskNativeOwnedScope(scope, context);
    const e = entry(scope, context), quote = context.quote, transfer = metaMaskNativeQuoteTransfer(quote);
    e.guardStage = "owner_guard";
    await assertCurrentLocal(scope, context);
    e.guardStage = "sdk_read";
    const vendor = await readMetaMaskNativeVendorPolicy(quote.chainId, quote.sender, transfer.recipient, deadline);
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
    if (op === null || op.state !== "effect_started" || op.effectAttempts !== 1 || canonicalJson(op.context) !== canonicalJson(context))
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
export async function runMetaMaskNativeTransfer(stateRoot, input) {
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
    return state.withLocks([`profile:${allowlistProfileHash(profileName)}`, `profile:${state.profileHash(profileName)}`, `operation:${id}`, "provider-session:metamask-agent-wallet", evmAddressLock(payer), `account-chain-nonce:${payer}:${chainId}`], async () => {
        const existing = await journal.read(id);
        if (existing !== null)
            return replay(existing);
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
        const vendor = await readMetaMaskNativeVendorPolicy(chainId, sender, recipient);
        if (vendor.selectedAddress.toLowerCase() !== payer || vendor.tradingMode !== "guard" || !/^[a-f0-9]{64}$/.test(vendor.vendorProjectHash))
            blocked("MetaMask vendor wallet or Guard mode differs from the paying profile.");
        const prepared = await prepareMetaMaskNativeQuote({ chainId, maximumNativeFeeWei: cap, sender, recipient, amountAtomic });
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
            op = await journal.persist(patch(op, { state: "effect_started", effectAttempts: 1 }));
            scope = Object.freeze({});
            scopes.set(scope, { root: stateRoot, context, journal, reservations, state: "issued", lockActive: true, monotonicDeadline: performance.now() + Math.min(60000, Date.parse(expires) - Date.now()), lastNow: Date.now(), guardStage: "sdk_resolver", startedAt: performance.now() });
            const result = await submitOwnedMetaMaskNative(scope, context);
            op = await journal.persist(patch(op, { ...(result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic }), ...(result.disposition === "acknowledged" ? { state: "acknowledged", transactionHash: result.transactionHash } : { state: "unknown", transactionHash: "transactionHash" in result ? result.transactionHash ?? null : null, providerRequestId: result.requestId ?? null }) }));
            for (const r of reservations)
                await ledger.transition({ ...transitionIdentity(r), state: result.disposition === "acknowledged" ? "submitted" : "unknown_finality", now: new Date() });
            return publicOperation(op);
        }
        catch (error) {
            if (op !== undefined) {
                if (op.effectAttempts === 1 && op.state === "effect_started" && error instanceof MetaMaskNativeHandoffNotStarted) {
                    // Proven no handoff: the vendor child never started, so the marker closes as failed before effect.
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
}
function transitionIdentity(r) { return { account: r.account, chain: r.chain, asset: r.asset, reservationId: r.reservationId, policyDigest: r.policyDigest }; }
function failureDiagnostic(error, context, scope) {
    const e = scope === undefined ? undefined : scopes.get(scope), deadline = Date.parse(nativeContextDeadline(context));
    return takeMetaMaskNativeProcessFailureDiagnostic(error) ?? (error instanceof ApnError && "nativeDiagnostic" in error ? validateMetaMaskNativeDiagnostic(error.nativeDiagnostic) : undefined) ?? validateMetaMaskNativeDiagnostic({
        stage: e?.guardStage ?? "owner_guard", code: Date.now() >= deadline || e !== undefined && performance.now() >= e.monotonicDeadline ? "deadline" : "refused", exitCode: null, signal: null,
        durationMs: Math.floor(e === undefined ? 0 : performance.now() - e.startedAt), remainingMs: Math.max(0, Math.min(60000, Math.floor(Math.min(deadline - Date.now(), e === undefined ? 60000 : e.monotonicDeadline - performance.now())))),
        stderrClass: "none", providerCode: "none"
    });
}
export async function readMetaMaskNativeTransfer(stateRoot, idInput, observe = false) {
    const id = canonicalOperationId(idInput), journal = new MetaMaskNativeJournal(stateRoot);
    if (await journal.read(id) === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
    return journal.withLocks([`operation:${id}`], async () => {
        let op = await journal.read(id);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
        let readObservation = observe ? Object.freeze({ stage: "not_requested", guard_step: null,
            request_id: op.providerRequestId, watch_returned: false, before_guard_verified: false, after_guard_verified: false,
            request_identity_verified: false, provider_status: null, transaction_hash: op.transactionHash, chain_id: op.context.quote.chainId,
            response_hash: null, reason: op.providerRequestId === null ? "no_stored_request_id" : "stored_transaction_or_confirmed", error_code: null, diagnostic: null }) : undefined;
        if (observe && op.transactionHash === null && op.providerRequestId !== null && op.effectAttempts === 1) {
            const hint = await readMetaMaskNativeRequest(op.providerRequestId, op.context.vendorProjectHash);
            readObservation = hint.readObservation;
            if (hint.requestId !== undefined && hint.requestId !== op.providerRequestId || hint.chainId !== undefined && hint.chainId !== op.context.quote.chainId)
                blocked("Native transfer stored provider request identity or chain changed.");
            const hash = "transactionHash" in hint ? hint.transactionHash : undefined;
            if (hash !== undefined)
                op = await journal.persist(patch(op, { state: "unknown", transactionHash: hash }));
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
        return { ...publicOperation(op), ...(readObservation === undefined ? {} : { read_observation: readObservation }) };
    });
}
/**
 * Owner release (R4) of a native transfer whose outcome stayed unknown after its quote expired. It observes once,
 * never sends, keeps the stored transaction hash or request id, and leaves the held usage consumed.
 */
export async function abandonMetaMaskNativeTransfer(stateRoot, idInput, approve, now) {
    const id = canonicalOperationId(idInput), journal = new MetaMaskNativeJournal(stateRoot);
    const initial = await journal.read(id);
    if (initial === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Native transfer operation does not exist.");
    if (initial.state === "abandoned_unknown")
        return publicOperation(initial);
    const eligible = (o) => ["effect_started", "acknowledged", "unknown"].includes(o.state) && now().getTime() >= Date.parse(o.context.quote.expiresAt);
    if (!eligible(initial))
        blocked("Only a native transfer with an unknown outcome can be abandoned, and only after its quote expired.");
    try {
        await readMetaMaskNativeTransfer(stateRoot, id, true);
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