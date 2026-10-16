import { privateKeyToAccount } from "viem/accounts";
import {} from "viem";
import { approvalCode } from "../approval-code.js";
import { hashObject } from "../canonical.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { activeAssetPolicyFromState, loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { withGaszipForegroundAuthority, gaszipEffectBinding, gaszipGuardRefused } from "./gaszip-authority.js";
import { gaszipNonceConsumed, gaszipUnlandedReason, gaszipUsageState } from "./gaszip-outcome.js";
import { ApnError } from "../errors.js";
import { EncryptedWalletStore, walletCustodyLock } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwner, assertExclusiveEvmOwnerIncludingGrants, evmAddressLock } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { assertBridgeOwner, bridgeOwner } from "./owner.js";
import { BridgeHttps } from "./https.js";
import { SEI_FUNDING, inspectSeiDelivery, inspectSeiFundingQuote, seiFail, seiHash, seiJson, seiQuantity, seiUint } from "./sei-gaszip-contract.js";
import { SeiFundingJournal, publicSeiFunding, sealSeiFunding } from "./sei-gaszip-journal.js";
import { SeiFundingRpc, assertSeiFundingFresh, readSeiFundingPlan, proveSeiDelivery, proveSeiSource } from "./sei-gaszip-rpc.js";
import { gaszipObservationRefusal } from "./gaszip-native-delivery.js";
const ORIGIN = "https://backend.gas.zip";
/** Strictly Base-native to Sei-native, self recipient; adapters cannot supply authoritative receipts in place of RPC reads. */
export class SeiFundingService {
    state;
    wrapping;
    environment;
    ports;
    journal;
    ledger;
    https;
    now;
    constructor(state, wrapping, environment, ports = {}) {
        this.state = state;
        this.wrapping = wrapping;
        this.environment = environment;
        this.ports = ports;
        this.journal = new SeiFundingJournal(state.root);
        this.ledger = new AssetUsageLedger(state.root);
        this.https = ports.https ?? new BridgeHttps();
        this.now = ports.now ?? Date.now;
    }
    rpc(kind) {
        const injected = this.ports[kind];
        if (injected !== undefined)
            return injected();
        const name = kind === "source" ? "APN_BASE_RPC_URL" : "APN_SEI_RPC_URL";
        const url = this.environment[name];
        if (url === undefined)
            seiFail(`${kind}_rpc_missing`);
        return new SeiFundingRpc(url, this.https);
    }
    identity(r) { return { account: r.owner.address, chain: "eip155:8453", asset: { kind: "native", identifier: null } }; }
    async policy(r, expected, underLock = false) {
        const p = underLock ? activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock(r.profile), new Date(this.now())) : await loadActiveAssetPolicyRegistry(this.state.root, r.profile, new Date(this.now()));
        if (p === null || p.accounts.evm !== r.owner.address || expected !== undefined && (p.digest !== expected.policyDigest || p.revision !== expected.policyRevision || p.activationDigest !== expected.activationDigest))
            seiFail("owner_policy_drift");
        const u = await this.ledger.usage(this.identity(r), new Date(this.now()));
        const reference = r.usageReservationId;
        const own = reference === undefined || reference === null ? null : await this.ledger.load(this.identity(r), reference);
        if (own !== null && (own.policyDigest !== p.digest || own.amountAtomic !== r.amountAtomic || !["reserved", "unknown_finality"].includes(own.state)))
            seiFail("prepared_usage_binding");
        const daily = (BigInt(u.amountAtomic) - (own === null ? 0n : BigInt(own.amountAtomic))).toString();
        evaluateAssetPolicy(p.registry, { chain: "eip155:8453", asset: { kind: "native", identifier: null }, rail: "bridge", mechanism: SEI_FUNDING.mechanism,
            amountAtomic: r.amountAtomic, dailyUsageAtomic: daily, asOfDate: new Date(this.now()).toISOString().slice(0, 10), asOf: new Date(this.now()).toISOString() });
        return p;
    }
    async required(id) { const r = await this.journal.findOperation(id); if (r === null)
        seiFail("missing_operation"); return r; }
    locks(r) { return [`profile:${r.profileHash}`, `operation:${r.operationId}`, evmAddressLock(r.owner.address)]; }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), idempotency = canonicalIdempotencyKey(input.idempotencyKey), bound = await bridgeOwner(this.state, profile);
        if (bound.owner.address !== input.expectedPayer)
            seiFail("expected_payer");
        const amount = seiUint(input.amountAtomic), floor = seiUint(input.minimumOutputAtomic), fee = seiUint(input.maximumFeeAtomic);
        if (amount <= 0n || amount > SEI_FUNDING.maximumAmount || floor < SEI_FUNDING.minimumOutput || fee <= 0n || fee > SEI_FUNDING.maximumFee)
            seiFail("input_caps");
        const operationId = this.state.operationId(profile, idempotency), idempotencyHash = this.state.idempotencyHash(idempotency), requestHash = hashObject(input);
        const ops = new OperationService(this.state);
        const prior = await ops.resolvePrepare({ kind: "sei_gaszip", profileHash: bound.owner.profileHash, operationId, idempotencyHash, requestHash });
        if (prior !== null) {
            if (prior.kind !== "sei_gaszip")
                seiFail("idempotency_kind");
            return publicSeiFunding(prior.record);
        }
        const p = await this.policy({ profile, owner: bound.owner, amountAtomic: amount.toString() });
        const url = new URL(`${ORIGIN}/v2/quotes/8453/${amount}/1329`);
        url.searchParams.set("from", bound.owner.address);
        url.searchParams.set("to", bound.owner.address);
        const response = await this.https.request(url.toString(), "GET", null, 64 * 1024, "APN_HTTP_CONFIG");
        if (response.status !== 200)
            seiFail("quote_http");
        const quote = inspectSeiFundingQuote(seiJson(response.body), this.now());
        if (BigInt(quote.expectedAtomic) < floor)
            seiFail("quote_owner_floor");
        const plan = await readSeiFundingPlan(this.rpc("source"), bound.owner.address, amount.toString(), fee.toString());
        if (Date.parse(quote.expiresAt) - this.now() < 30_000)
            seiFail("prepare_quote_expired");
        const record = sealSeiFunding({ schemaVersion: "apn.sei-gaszip-operation.v1", operationId, profileHash: bound.owner.profileHash, idempotencyHash, requestHash, profile, ...bound,
            amountAtomic: amount.toString(), minimumOutputAtomic: floor.toString(), maximumFeeAtomic: fee.toString(), quoteDigest: quote.digest, quoteExpectedAtomic: quote.expectedAtomic,
            expiresAt: quote.expiresAt, policyDigest: p.digest, policyRevision: p.revision, activationDigest: p.activationDigest, plan, state: "prepared", terminal: false, rawTransaction: null, transactionHash: null,
            submissionAttempts: 0, usageReservationId: assetUsageReservationId({ account: bound.owner.address, chain: "eip155:8453", asset: { kind: "native", identifier: null } }, `sei-gaszip:${operationId}`), outcomeDigest: null, sourceProof: null, destinationProof: null });
        await this.state.initialize();
        return this.state.withLocks([...this.locks(record), `operation:idempotency:${idempotencyHash}`], async () => this.state.withLocks([`profile:${allowlistProfileHash(profile)}`], async () => {
            const found = await ops.resolvePrepare({ kind: "sei_gaszip", profileHash: record.profileHash, operationId, idempotencyHash, requestHash });
            if (found !== null) {
                if (found.kind !== "sei_gaszip")
                    seiFail("idempotency_kind");
                return publicSeiFunding(found.record);
            }
            await ops.assertEvmAccountAvailable(record.profileHash, 8453, record.owner.address);
            await ops.assertEvmAccountAvailable(record.profileHash, 1329, record.owner.address);
            await assertExclusiveEvmOwner(this.state, record.owner.address, record.profileHash);
            await assertBridgeOwner(this.state, record);
            await this.policy(record, record, true);
            await this.journal.saveLocked(record, true);
            return publicSeiFunding(record);
        }));
    }
    async approve(id) {
        let r = await this.required(id);
        if (r.state !== "prepared")
            return publicSeiFunding(r);
        if (r.activationDigest === undefined)
            seiFail("legacy_activation_missing");
        await assertBridgeOwner(this.state, r);
        await this.policy(r, r);
        if (Date.parse(r.expiresAt) - this.now() < 20_000)
            seiFail("approval_expiry");
        const binding = gaszipEffectBinding(r, "sei");
        return withGaszipForegroundAuthority(binding, r.expiresAt, this.now, async () => {
            if (this.ports.approve !== undefined)
                await this.ports.approve(r);
            else
                await exactChainConsent([
                    `GasZip direct Base ETH -> Sei SEI SELF ONLY`, `Profile ${r.profile}; owner and recipient ${r.owner.address}`,
                    `Source ${r.amountAtomic} wei; source network fee quote ceiling ${r.maximumFeeAtomic} wei (Base total is not an on-chain cap)`,
                    `Target ${SEI_FUNDING.target}; calldata ${SEI_FUNDING.data}; minimum delivered ${r.minimumOutputAtomic} wei SEI`,
                    `Destination floor is an acceptance requirement, not enforced by the source transaction.`,
                    `No approval transactions. One signature and one send. Unknown outcomes retain their hold.`,
                    `Operation ${r.operationId}; policy ${r.policyDigest}; quote ${r.quoteDigest}; expires ${r.expiresAt}`,
                ], approvalCode("bridge", r.operationId, r.integrityHash), r.expiresAt, {});
        }, async (authority) => this.state.withLocks([walletCustodyLock(this.state, r.profile)], async () => this.state.withLocks(this.locks(r), async () => this.state.withLocks([`profile:${allowlistProfileHash(r.profile)}`], async () => {
            let saved = await this.required(id);
            if (saved.state !== "prepared" || saved.integrityHash !== r.integrityHash)
                seiFail("approval_record_drift");
            const check = async () => {
                await assertBridgeOwner(this.state, saved);
                await assertExclusiveEvmOwnerIncludingGrants(this.state, new EncryptedSmartAccountPermissionStore(this.state, this.wrapping), saved.owner.address, saved.profileHash);
                const active = await this.policy(saved, saved, true);
                authority.assert(gaszipEffectBinding(saved, "sei"), active.registry.expiresAt);
                return active;
            };
            let active = await check();
            const fresh = await readSeiFundingPlan(this.rpc("source"), saved.owner.address, saved.amountAtomic, saved.maximumFeeAtomic, saved.plan);
            assertSeiFundingFresh(saved.plan, fresh, saved.maximumFeeAtomic);
            active = await check();
            const reservation = await this.ledger.reserve({ ...this.identity(saved), registry: active.registry, rail: "bridge", mechanism: SEI_FUNDING.mechanism,
                amountAtomic: saved.amountAtomic, idempotencyKey: `sei-gaszip:${id}`, now: new Date(this.now()) });
            if (reservation.reservationId !== saved.usageReservationId)
                seiFail("reservation_reference");
            const wallet = new EncryptedWalletStore(this.state, this.wrapping), loaded = await wallet.describe(saved.profile);
            if (loaded === null)
                seiFail("wallet_missing");
            try {
                const account = privateKeyToAccount(loaded.secret.privateKey);
                if (account.address !== saved.owner.address || loaded.identity.bindingHash !== saved.owner.walletBindingHash)
                    seiFail("signing_owner");
                await check();
                authority.assert(binding);
                if (Date.parse(saved.expiresAt) - this.now() < 10_000)
                    seiFail("post_approval_expiry");
                await this.journal.claimSigningLocked(saved);
                saved = sealSeiFunding({ ...saved, state: "signing_started" });
                await this.journal.saveLocked(saved);
                await this.usage(saved, "unknown_finality");
                authority.assert(binding);
                const raw = await account.signTransaction({ type: "eip1559", chainId: 8453, to: SEI_FUNDING.target, data: SEI_FUNDING.data, value: BigInt(saved.amountAtomic),
                    nonce: Number(BigInt(saved.plan.nonce)), gas: BigInt(saved.plan.gas), maxFeePerGas: BigInt(saved.plan.maxFee), maxPriorityFeePerGas: BigInt(saved.plan.tip) });
                saved = await this.journal.sealTransaction(saved, raw);
            }
            finally {
                wallet.clear(loaded.secret);
            }
            await check();
            authority.assert(binding);
            if (saved.rawTransaction === null || saved.transactionHash === null)
                seiFail("sealed_material_missing");
            const guard = authority.beforeSend(binding, saved.rawTransaction, saved.transactionHash);
            await this.journal.claimSendLocked(saved);
            saved = sealSeiFunding({ ...saved, state: "submitting", submissionAttempts: 1 });
            await this.journal.saveLocked(saved);
            let sent = false, unsent = null;
            try {
                const returned = await this.rpc("source").call("eth_sendRawTransaction", [saved.rawTransaction], guard);
                if (seiHash(returned) !== saved.transactionHash)
                    seiFail("send_hash");
                sent = true;
            }
            catch (error) {
                // A refused guard proves the bytes never left APN; a definite JSON-RPC refusal proves the node did not take them.
                // Every other failure keeps unknown finality and is never resent.
                unsent = gaszipGuardRefused(guard) ? "authority_refused_before_transport" :
                    error instanceof ApnError && error.details?.reason === "sei_gaszip_send_rejected" ? "send_rejected" : null;
            }
            saved = unsent === null ? sealSeiFunding({ ...saved, state: sent ? "submitted" : "unknown_finality" }) : this.unlanded(saved, unsent);
            await this.journal.saveLocked(saved);
            if (saved.terminal)
                await this.usage(saved, "failed_before_effect");
            return publicSeiFunding(saved);
        }))));
    }
    async usage(r, state) {
        const current = r.usageReservationId === null ? null : await this.ledger.load(this.identity(r), r.usageReservationId);
        if (current === null || r.usageReservationId === null)
            return;
        // The hold moved to unknown finality before signing; bytes proven never sent release it as unsubmitted.
        const target = state === "failed_before_effect" && ["unknown_finality", "released_unsubmitted"].includes(current.state) ? "released_unsubmitted" : state;
        await this.ledger.transition({ ...this.identity(r), reservationId: r.usageReservationId, policyDigest: r.policyDigest,
            state: target, now: new Date(this.now()), ...(r.outcomeDigest === null ? {} : { outcomeDigest: r.outcomeDigest }) });
    }
    /** A signed effect APN proved never landed ends before effect: its bytes are scrubbed and never sent again. */
    unlanded(r, reason) {
        return sealSeiFunding({ ...r, state: "failed_before_effect", terminal: true, rawTransaction: null, transactionHash: null,
            outcomeDigest: hashObject({ id: r.operationId, ...gaszipUnlandedReason(reason, r.transactionHash) }) });
    }
    async retireUnlanded(r, reason) {
        const ended = await this.state.withLocks(this.locks(r), async () => {
            const saved = await this.required(r.operationId);
            if (saved.terminal || saved.transactionHash !== r.transactionHash || saved.state !== r.state)
                return saved;
            // Every broadcast follows the create-only first-send marker. A marker the journal never recorded is an interrupted send
            // step: it becomes an observed unknown attempt, never a resend.
            const next = reason === "signed_never_sent" && saved.state === "sealed" && await this.journal.sendClaimedLocked(saved)
                ? sealSeiFunding({ ...saved, state: "unknown_finality", submissionAttempts: 1 }) : this.unlanded(saved, reason);
            await this.journal.saveLocked(next);
            return next;
        });
        if (ended.terminal)
            await this.usage(ended, gaszipUsageState(ended.state));
        return ended;
    }
    async status(id) {
        let r = await this.required(id);
        if (r.terminal) {
            await this.usage(r, gaszipUsageState(r.state));
            return publicSeiFunding(r);
        }
        if (r.state === "prepared") {
            if (this.now() < Date.parse(r.expiresAt))
                return publicSeiFunding(r);
            const ended = await this.state.withLocks(this.locks(r), async () => {
                const saved = await this.required(id);
                if (saved.state !== "prepared")
                    return saved;
                // Signing follows the durable signing_started save, so a first-sign marker on a prepared record signed nothing; only a
                // first-send marker could mean a broadcast.
                if (await this.journal.sendClaimedLocked(saved))
                    seiFail("effect_marker_blocks_retirement");
                const next = sealSeiFunding({ ...saved, state: "failed_before_effect", terminal: true, outcomeDigest: hashObject({ id, reason: "unsigned_quote_expired" }) });
                await this.journal.saveLocked(next);
                return next;
            });
            if (ended.state === "failed_before_effect")
                await this.usage(ended, "failed_before_effect");
            return publicSeiFunding(ended);
        }
        // Approve never resumes a record that left "prepared", and the send step always runs to a recorded outcome, so a signed
        // effect still at signing_started or sealed was never broadcast.
        if (r.state === "signing_started" || r.state === "sealed")
            return publicSeiFunding(await this.retireUnlanded(r, "signed_never_sent"));
        if (r.transactionHash === null)
            return publicSeiFunding(r);
        let phase = "source_proof", source = null, destination = null, claimHash = null, failed = false;
        try {
            source = await proveSeiSource(this.rpc("source"), r);
            if (source === null)
                return await gaszipNonceConsumed(this.rpc("source"), r.owner.address, r.plan.nonce, seiQuantity)
                    ? publicSeiFunding(await this.retireUnlanded(r, "nonce_consumed_unlanded")) : publicSeiFunding(r);
            if (source.status === "success") {
                phase = "provider_correlation";
                const response = await this.https.request(`${ORIGIN}/v2/deposit/${r.transactionHash}`, "GET", null, 256 * 1024, "APN_HTTP_CONFIG");
                if (response.status !== 200)
                    seiFail("status_http");
                const d = inspectSeiDelivery(seiJson(response.body), r.transactionHash, r.owner.address, r.amountAtomic, source.blockNumber);
                if (d === null)
                    return publicSeiFunding(r);
                if ("providerFailure" in d) {
                    destination = d;
                    failed = true;
                }
                else {
                    phase = "destination_proof";
                    const proof = await proveSeiDelivery(this.rpc("destination"), r.owner.address, d);
                    if (proof === null)
                        return publicSeiFunding(r);
                    // A proved payout below the owner's floor still arrived: it ends as a destination failure, not an open operation.
                    failed = BigInt(proof.amount) < BigInt(r.minimumOutputAtomic);
                    destination = { ...proof, providerDigest: d.providerDigest, ...(failed ? { belowOwnerFloor: true } : {}) };
                    claimHash = d.hash;
                }
            }
        }
        catch (error) {
            return gaszipObservationRefusal(error, id, phase, "apn sei funding status");
        }
        if (source === null)
            return publicSeiFunding(r);
        // The Base L1 part is not capped by the signature: an actual fee over the owner's quote ceiling is reported, never a wedge.
        const sourceProof = { ...source, feeCapExceeded: source.actualFee === null || BigInt(source.actualFee) > BigInt(r.maximumFeeAtomic) };
        r = await this.state.withLocks([...this.locks(r), "sei-gaszip:destination-claims"], async () => {
            const saved = await this.required(id);
            if (saved.terminal)
                return saved;
            if (saved.transactionHash !== r.transactionHash)
                seiFail("observation_record_drift");
            if (claimHash !== null)
                await this.journal.claimDestinationLocked(claimHash, id);
            const outcomeDigest = hashObject({ source: sourceProof, destination });
            const next = sealSeiFunding({ ...saved, state: sourceProof.status !== "success" ? "failed_confirmed_revert" : failed ? "destination_failed" : "completed",
                terminal: true, sourceProof, destinationProof: destination, outcomeDigest });
            await this.journal.saveLocked(next);
            return next;
        });
        await this.usage(r, gaszipUsageState(r.state));
        return publicSeiFunding(r);
    }
}
//# sourceMappingURL=sei-gaszip-service.js.map