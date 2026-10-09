import { privateKeyToAccount } from "viem/accounts";
import {} from "viem";
import { approvalCode } from "../approval-code.js";
import { hashObject } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { assertBridgeOwner, bridgeOwner } from "./owner.js";
import { BridgeHttps } from "./https.js";
import { SEI_FUNDING, inspectSeiDelivery, inspectSeiFundingQuote, seiFail, seiHash, seiJson, seiUint } from "./sei-gaszip-contract.js";
import { SeiFundingJournal, publicSeiFunding, sealSeiFunding } from "./sei-gaszip-journal.js";
import { SeiFundingRpc, assertSeiFundingFresh, readSeiFundingPlan, proveSeiDelivery, proveSeiSource } from "./sei-gaszip-rpc.js";
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
    async policy(r, expected) {
        const p = await loadActiveAssetPolicyRegistry(this.state.root, r.profile, new Date(this.now()));
        if (p === null || p.accounts.evm !== r.owner.address || expected !== undefined && (p.digest !== expected.policyDigest || p.revision !== expected.policyRevision))
            seiFail("owner_policy_drift");
        const u = await this.ledger.usage(this.identity(r), new Date(this.now()));
        const reference = r.usageReservationId;
        const own = reference === undefined || reference === null ? null : await this.ledger.load(this.identity(r), reference);
        if (own !== null && (own.policyDigest !== p.digest || own.amountAtomic !== r.amountAtomic || own.state !== "reserved"))
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
            expiresAt: quote.expiresAt, policyDigest: p.digest, policyRevision: p.revision, plan, state: "prepared", terminal: false, rawTransaction: null, transactionHash: null,
            submissionAttempts: 0, usageReservationId: assetUsageReservationId({ account: bound.owner.address, chain: "eip155:8453", asset: { kind: "native", identifier: null } }, `sei-gaszip:${operationId}`), outcomeDigest: null, sourceProof: null, destinationProof: null });
        await this.state.initialize();
        return this.state.withLocks([...this.locks(record), `operation:idempotency:${idempotencyHash}`], async () => {
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
            await this.journal.saveLocked(record, true);
            return publicSeiFunding(record);
        });
    }
    async approve(id) {
        let r = await this.required(id);
        if (r.state !== "prepared")
            return publicSeiFunding(r);
        await assertBridgeOwner(this.state, r);
        await this.policy(r, r);
        if (Date.parse(r.expiresAt) - this.now() < 20_000)
            seiFail("approval_expiry");
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
        const fresh = await readSeiFundingPlan(this.rpc("source"), r.owner.address, r.amountAtomic, r.maximumFeeAtomic, r.plan.feeUpper);
        assertSeiFundingFresh(r.plan, fresh);
        if (Date.parse(r.expiresAt) - this.now() < 10_000)
            seiFail("post_approval_expiry");
        const p = await this.policy(r, r);
        const reservation = await this.ledger.reserve({ ...this.identity(r), registry: p.registry, rail: "bridge", mechanism: SEI_FUNDING.mechanism,
            amountAtomic: r.amountAtomic, idempotencyKey: `sei-gaszip:${id}`, now: new Date(this.now()) });
        if (reservation.reservationId !== r.usageReservationId)
            seiFail("reservation_reference");
        r = await this.state.withLocks(this.locks(r), async () => {
            const saved = await this.required(id);
            if (saved.state !== "prepared" || saved.integrityHash !== r.integrityHash)
                seiFail("approval_record_drift");
            await assertBridgeOwner(this.state, saved);
            await assertExclusiveEvmOwner(this.state, saved.owner.address, saved.profileHash);
            await this.journal.claimSigningLocked(saved);
            const next = sealSeiFunding({ ...saved, state: "signing_started", usageReservationId: reservation.reservationId });
            await this.journal.saveLocked(next);
            return next;
        });
        await this.usage(r, "unknown_finality");
        r = await this.state.withLocks(this.locks(r), async () => {
            const saved = await this.required(id);
            if (saved.integrityHash !== r.integrityHash || saved.state !== "signing_started" || Date.parse(saved.expiresAt) - this.now() < 5_000)
                seiFail("signing_record_drift");
            await assertBridgeOwner(this.state, saved);
            await assertExclusiveEvmOwner(this.state, saved.owner.address, saved.profileHash);
            const active = await loadActiveAssetPolicyRegistry(this.state.root, saved.profile, new Date(this.now()));
            if (active?.digest !== saved.policyDigest || active.revision !== saved.policyRevision)
                seiFail("signing_policy_drift");
            const wallet = new EncryptedWalletStore(this.state, this.wrapping), loaded = await wallet.describe(saved.profile);
            if (loaded === null)
                seiFail("wallet_missing");
            try {
                const account = privateKeyToAccount(loaded.secret.privateKey);
                if (account.address !== saved.owner.address || loaded.identity.bindingHash !== saved.owner.walletBindingHash)
                    seiFail("signing_owner");
                const raw = await account.signTransaction({ type: "eip1559", chainId: 8453, to: SEI_FUNDING.target, data: SEI_FUNDING.data, value: BigInt(saved.amountAtomic),
                    nonce: Number(BigInt(saved.plan.nonce)), gas: BigInt(saved.plan.gas), maxFeePerGas: BigInt(saved.plan.maxFee), maxPriorityFeePerGas: BigInt(saved.plan.tip) });
                return await this.journal.sealTransaction(saved, raw);
            }
            finally {
                wallet.clear(loaded.secret);
            }
        });
        r = await this.state.withLocks(this.locks(r), async () => {
            const saved = await this.required(id);
            if (saved.integrityHash !== r.integrityHash || saved.state !== "sealed" || Date.parse(saved.expiresAt) - this.now() < 3_000)
                seiFail("send_record_drift");
            await assertBridgeOwner(this.state, saved);
            await assertExclusiveEvmOwner(this.state, saved.owner.address, saved.profileHash);
            const active = await loadActiveAssetPolicyRegistry(this.state.root, saved.profile, new Date(this.now()));
            if (active?.digest !== saved.policyDigest || active.revision !== saved.policyRevision)
                seiFail("send_policy_drift");
            await this.journal.claimSendLocked(saved);
            const next = sealSeiFunding({ ...saved, state: "submitting", submissionAttempts: 1 });
            await this.journal.saveLocked(next);
            return next;
        });
        let sent = false;
        try {
            const returned = await this.rpc("source").call("eth_sendRawTransaction", [r.rawTransaction]);
            if (seiHash(returned) !== r.transactionHash)
                seiFail("send_hash");
            sent = true;
        }
        catch { /* The durable attempt stays observe only on every ambiguous response. */ }
        return this.state.withLocks(this.locks(r), async () => {
            const saved = await this.required(id);
            if (saved.state !== "submitting")
                return publicSeiFunding(saved);
            const next = sealSeiFunding({ ...saved, state: sent ? "submitted" : "unknown_finality" });
            await this.journal.saveLocked(next);
            return publicSeiFunding(next);
        });
    }
    async usage(r, state) {
        if (r.usageReservationId === null || await this.ledger.load(this.identity(r), r.usageReservationId) === null)
            return;
        await this.ledger.transition({ ...this.identity(r), reservationId: r.usageReservationId, policyDigest: r.policyDigest,
            state, now: new Date(this.now()), ...(r.outcomeDigest === null ? {} : { outcomeDigest: r.outcomeDigest }) });
    }
    async status(id) {
        let r = await this.required(id);
        if (r.terminal) {
            await this.usage(r, r.state === "completed" ? "finalized" : r.state === "failed_confirmed_revert" ? "failed_confirmed_revert" : "failed_before_effect");
            return publicSeiFunding(r);
        }
        if (r.state === "prepared") {
            if (this.now() < Date.parse(r.expiresAt))
                return publicSeiFunding(r);
            const ended = await this.state.withLocks(this.locks(r), async () => {
                const saved = await this.required(id);
                if (saved.state !== "prepared")
                    return saved;
                await this.journal.assertNoEffectClaimsLocked(saved);
                const next = sealSeiFunding({ ...saved, state: "failed_before_effect", terminal: true, outcomeDigest: hashObject({ id, reason: "unsigned_quote_expired" }) });
                await this.journal.saveLocked(next);
                return next;
            });
            if (ended.state === "failed_before_effect")
                await this.usage(ended, "failed_before_effect");
            return publicSeiFunding(ended);
        }
        if (r.transactionHash === null)
            return publicSeiFunding(r);
        const source = await proveSeiSource(this.rpc("source"), r);
        if (source === null)
            return publicSeiFunding(r);
        if (source.actualFee === null || BigInt(source.actualFee) > BigInt(r.maximumFeeAtomic))
            seiFail("source_actual_fee_cap");
        let destination = null, claimHash = null;
        if (source.status === "success") {
            const response = await this.https.request(`${ORIGIN}/v2/deposit/${r.transactionHash}`, "GET", null, 256 * 1024, "APN_HTTP_CONFIG");
            if (response.status !== 200)
                seiFail("status_http");
            const d = inspectSeiDelivery(seiJson(response.body), r.transactionHash, r.owner.address, r.amountAtomic, source.blockNumber);
            if (d === null)
                return publicSeiFunding(r);
            if (BigInt(d.amount) < BigInt(r.minimumOutputAtomic))
                seiFail("delivery_owner_floor");
            const proof = await proveSeiDelivery(this.rpc("destination"), r.owner.address, d);
            if (proof === null)
                return publicSeiFunding(r);
            destination = { ...proof, providerDigest: d.providerDigest };
            claimHash = d.hash;
        }
        r = await this.state.withLocks([...this.locks(r), "sei-gaszip:destination-claims"], async () => {
            const saved = await this.required(id);
            if (saved.terminal)
                return saved;
            if (saved.transactionHash !== r.transactionHash)
                seiFail("observation_record_drift");
            if (claimHash !== null)
                await this.journal.claimDestinationLocked(claimHash, id);
            const outcomeDigest = hashObject({ source, destination });
            const next = sealSeiFunding({ ...saved, state: source.status === "success" ? "completed" : "failed_confirmed_revert",
                terminal: true, sourceProof: source, destinationProof: destination, outcomeDigest });
            await this.journal.saveLocked(next);
            return next;
        });
        await this.usage(r, r.state === "completed" ? "finalized" : "failed_confirmed_revert");
        return publicSeiFunding(r);
    }
}
//# sourceMappingURL=sei-gaszip-service.js.map