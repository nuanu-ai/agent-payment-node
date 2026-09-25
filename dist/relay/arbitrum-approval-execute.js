/** One guarded approval transaction for a saved Arbitrum USDC Relay operation. */
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwnerIncludingGrants, evmAddressLock } from "../evm-address-ownership.js";
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumApprovalPreflightReader } from "./arbitrum-approval-preflight.js";
import { RELAY_ARBITRUM_USDC } from "./arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "./arbitrum-usdc-source-draft.js";
import { ETHEREUM_DEPOSITORY } from "./quote.js";
const HASH = /^[a-f0-9]{64}$/u;
function blocked(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum approval execution is blocked.", { reason }); }
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
/** Unlocks local custody only after a durable signing marker exists. */
export class LocalRelayArbitrumApprovalSigner {
    state;
    wallets;
    constructor(state, wrapping) {
        this.state = state;
        this.wallets = new EncryptedWalletStore(state, wrapping);
    }
    async sign(op, nonce, journal) {
        if (journal.effects[0].phase !== "signing_started" || journal.effects[1].phase !== "pending" ||
            journal.operationIntegrityHash !== op.integrityHash || !/^(0|[1-9][0-9]*)$/u.test(nonce) ||
            BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER))
            blocked("durable_signing_marker_or_nonce");
        const saved = await new ArbitrumSourceEffectJournalRepository(this.state.root).load(op.profileHash, op.operationId);
        if (saved?.integrityHash !== journal.integrityHash)
            blocked("signing_marker_changed");
        const wallet = await this.wallets.describe(op.arbitrumDraft.profile);
        if (wallet === null)
            blocked("encrypted_wallet_missing");
        try {
            if (wallet.identity.profile !== op.arbitrumDraft.profile || !same(wallet.identity.address, op.sourceAccount))
                blocked("encrypted_wallet_owner");
            const account = privateKeyToAccount(wallet.secret.privateKey);
            if (!same(account.address, op.sourceAccount))
                blocked("local_signer_owner");
            const approval = op.arbitrumDraft.rawQuote.steps[0].items[0].data;
            if (!same(approval.to, RELAY_ARBITRUM_USDC) || approval.value !== "0" ||
                BigInt(approval.gas) * BigInt(approval.maxFeePerGas) > BigInt(op.approvalNetworkFeeCeilingWei))
                blocked("approval_envelope");
            return await account.signTransaction({ type: "eip1559", chainId: 42161, to: approval.to,
                data: approval.data, value: 0n, nonce: Number(BigInt(nonce)), gas: BigInt(approval.gas),
                maxFeePerGas: BigInt(approval.maxFeePerGas), maxPriorityFeePerGas: BigInt(approval.maxPriorityFeePerGas), accessList: [] });
        }
        finally {
            this.wallets.clear(wallet.secret);
        }
    }
}
export class RelayArbitrumApprovalExecuteService {
    state;
    reader;
    ports;
    journals;
    permissions;
    usage;
    constructor(state, reader, ports, wrapping) {
        this.state = state;
        this.reader = reader;
        this.ports = ports;
        this.journals = ports.journals ?? new ArbitrumSourceEffectJournalRepository(state.root);
        this.permissions = new EncryptedSmartAccountPermissionStore(state, wrapping);
        this.usage = new AssetUsageLedger(state.root);
    }
    now() {
        const at = this.ports.now?.() ?? new Date();
        if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
            blocked("invalid_clock");
        return at;
    }
    async owner(op) {
        await assertExclusiveEvmOwnerIncludingGrants(this.state, this.permissions, op.sourceAccount, op.profileHash);
        const profile = await this.state.loadProviderProfile(op.profileHash);
        if (profile !== null && !same(profile.public_address, op.sourceAccount))
            blocked("provider_owner_changed");
        const wallet = await this.state.loadWallet(op.profileHash);
        if (wallet !== null && !same(wallet.address, op.sourceAccount))
            blocked("public_wallet_owner_changed");
    }
    async snapshot(op, active) {
        const at = this.now();
        await this.owner(op);
        if (active.profile !== op.arbitrumDraft.profile || active.digest !== op.policyDigest || active.revision !== op.policyRevision ||
            !same(active.accounts.evm ?? "", op.sourceAccount))
            blocked("active_owner_policy_required");
        const usage = await (this.ports.dailyUsage?.(op.sourceAccount, at) ?? this.dailyUsageExcludingOwn(op, at));
        return this.reader.read(op, active, op.sourceAccount, usage, at, () => this.now());
    }
    usageIdentity(op) {
        return { account: getAddress(op.sourceAccount), chain: "eip155:42161",
            asset: { kind: "token", identifier: RELAY_ARBITRUM_USDC } };
    }
    reservationId(op) {
        return assetUsageReservationId(this.usageIdentity(op), `relay-arbitrum-approval:${op.operationId}`);
    }
    async dailyUsageExcludingOwn(op, at) {
        const { snapshot, reservation } = await this.usage.usageWithReservation(this.usageIdentity(op), this.reservationId(op), at);
        const own = reservation !== null && !["failed_before_effect", "failed_confirmed_revert"].includes(reservation.state) &&
            reservation.reservedAt.slice(0, 10) === at.toISOString().slice(0, 10) ? BigInt(op.amountAtomic) : 0n;
        if (BigInt(snapshot.amountAtomic) < own || reservation !== null &&
            (reservation.amountAtomic !== op.amountAtomic || reservation.policyDigest !== op.policyDigest))
            blocked("usage_reservation_changed");
        return (BigInt(snapshot.amountAtomic) - own).toString();
    }
    async reserve(op, active) {
        const at = this.now();
        if (active.profile !== op.arbitrumDraft.profile || active.digest !== op.policyDigest || active.revision !== op.policyRevision ||
            !same(active.accounts.evm ?? "", op.sourceAccount))
            blocked("active_policy_changed_before_lease");
        const reservation = await this.usage.reserve({ ...this.usageIdentity(op), registry: active.registry,
            rail: "bridge", mechanism: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE },
            amountAtomic: op.amountAtomic, idempotencyKey: `relay-arbitrum-approval:${op.operationId}`, now: at });
        if (reservation.state !== "reserved" || reservation.policyDigest !== op.policyDigest)
            blocked("usage_lease_unavailable");
    }
    result(op, journal, state, reason) {
        return { operationId: op.operationId, state, reason, approvalPhase: journal?.effects[0].phase ?? null,
            depositPhase: journal?.effects[1].phase ?? null,
            transactionHash: journal?.effects[0].attempt?.transactionHash ?? null,
            journalIntegrityHash: journal?.integrityHash ?? null, depositDispatched: false,
            destinationDeliveryProven: false, paidAcceptance: false };
    }
    async lockedPolicy(profile) {
        const at = this.now();
        return this.ports.activePolicyUnderLock === undefined ? activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock(profile), at) :
            this.ports.activePolicyUnderLock(at);
    }
    async execute(profile, operationId) {
        allowlistProfileHash(profile);
        if (!HASH.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay Arbitrum approval requires an operation ID.");
        const profileHash = this.state.profileHash(profile);
        const op = await (this.ports.operation?.(profileHash, operationId) ??
            new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId));
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay Arbitrum operation was not found.");
        if (op.arbitrumDraft === undefined || op.profileHash !== profileHash || op.arbitrumDraft.profile !== profile ||
            op.sourceChainId !== 42161 || op.destinationChainId !== 1 ||
            op.arbitrumDraft.executionAdmitted !== false)
            blocked("exact_saved_arbitrum_route_required");
        if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
            blocked("operation_retired");
        const previous = await this.journals.load(profileHash, operationId);
        if (previous !== null && (previous.effects[0].phase !== "pending" || previous.effects[1].phase !== "pending"))
            return this.result(op, previous, "observation_only", "approval_effect_already_started");
        const summary = { operationId, sourceChainId: 42161, destinationChainId: 1,
            owner: op.sourceAccount, token: RELAY_ARBITRUM_USDC, spender: ETHEREUM_DEPOSITORY,
            approvalValueAtomic: op.amountAtomic, quoteDigest: op.quoteDigest, deadline: op.deadline,
            approvalNetworkFeeCeilingWei: op.approvalNetworkFeeCeilingWei };
        if (!await this.ports.confirm(summary))
            blocked("foreground_authorization_declined");
        // No terminal wait occurs under a policy lock. Every effect-side lock is then acquired together
        // in SecureStateStore's profile -> operation -> remaining-key order.
        return this.state.withLocks([`profile:${profileHash}`, `profile:${allowlistProfileHash(profile)}`,
            `operation:${operationId}`, `relay-arbitrum-effect:${operationId}`,
            `relay-arbitrum-approval-execute:${operationId}`, evmAddressLock(op.sourceAccount)], async () => {
            if (await new RelayRetirementRepository(this.state.root).load(op) !== null)
                blocked("operation_retired");
            let journal = await this.journals.load(profileHash, operationId);
            if (journal !== null && (journal.effects[0].phase !== "pending" || journal.effects[1].phase !== "pending"))
                return this.result(op, journal, "observation_only", "approval_effect_already_started");
            const firstPolicy = await this.lockedPolicy(profile);
            if (firstPolicy === null)
                blocked("active_owner_policy_required");
            const first = await this.snapshot(op, firstPolicy);
            if (!first.approvalRequired)
                return this.result(op, journal, "approval_not_needed", "fresh_allowance_covers_principal");
            if (!first.readOnlyConditionsSatisfied)
                blocked(`preflight:${first.reasons.join(",")}`);
            // A second canonical read closes the gap between owner consent and the irreversible marker.
            const freshPolicy = await this.lockedPolicy(profile);
            if (freshPolicy === null)
                blocked("active_owner_policy_required");
            const fresh = await this.snapshot(op, freshPolicy);
            if (!fresh.approvalRequired || !fresh.readOnlyConditionsSatisfied ||
                fresh.confirmedNonce !== fresh.pendingNonce)
                blocked("approval_preflight_changed");
            if (journal === null)
                journal = await this.journals.createUnderLocks(profileHash, operationId, this.now().toISOString());
            await this.reserve(op, freshPolicy);
            journal = await this.journals.beginSigningUnderLocks(profileHash, operationId, journal.integrityHash, "approval", this.now().toISOString());
            let raw;
            try {
                raw = await this.ports.signer.sign(op, fresh.confirmedNonce, journal);
            }
            catch {
                return this.result(op, journal, "observation_only", "signing_outcome_uncertain");
            }
            journal = await this.journals.transitionUnderLocks(profileHash, operationId, journal.integrityHash, { kind: "seal_signed", role: "approval", rawTransaction: raw, nonce: fresh.confirmedNonce });
            // Re-read the authenticated policy head under the same profile lock and keep it until the send settles.
            const finalPolicy = await this.lockedPolicy(profile);
            if (finalPolicy === null || finalPolicy.profile !== profile || finalPolicy.digest !== op.policyDigest ||
                finalPolicy.revision !== op.policyRevision || !same(finalPolicy.accounts.evm ?? "", op.sourceAccount))
                return this.result(op, journal, "observation_only", "active_policy_revoked_or_changed");
            try {
                const final = await this.snapshot(op, finalPolicy);
                if (!final.approvalRequired || !final.readOnlyConditionsSatisfied ||
                    final.confirmedNonce !== fresh.confirmedNonce || final.pendingNonce !== fresh.confirmedNonce ||
                    this.now().getTime() - Date.parse(final.observedAt) > 30_000)
                    blocked("pre_send_conditions_changed");
            }
            catch {
                return this.result(op, journal, "observation_only", "pre_send_conditions_unavailable");
            }
            await this.owner(op);
            journal = await this.journals.transitionUnderLocks(profileHash, operationId, journal.integrityHash, { kind: "mark_submitting", role: "approval", at: this.now().toISOString() });
            const expectedHash = journal.effects[0].attempt.transactionHash;
            let outcome = "uncertain";
            try {
                if (await this.ports.send(raw) === expectedHash)
                    outcome = "accepted";
            }
            catch { /* A transport error, including HTTP 429, leaves one ambiguous send. */ }
            journal = await this.journals.transitionUnderLocks(profileHash, operationId, journal.integrityHash, { kind: "record_send", role: "approval", outcome });
            await this.usage.transition({ ...this.usageIdentity(op), reservationId: this.reservationId(op),
                policyDigest: op.policyDigest, state: outcome === "accepted" ? "submitted" : "unknown_finality",
                expectedCurrentStates: ["reserved"], now: this.now() });
            return this.result(op, journal, outcome === "accepted" ? "approval_submitted" : "observation_only", outcome === "accepted" ? "single_send_accepted" : "single_send_uncertain");
        });
    }
}
//# sourceMappingURL=arbitrum-approval-execute.js.map