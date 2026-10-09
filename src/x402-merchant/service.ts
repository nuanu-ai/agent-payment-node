import { canonicalJson, hashObject } from "../canonical.js";
import { evmNativeCustody } from "../evm-native-custody.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import type { HttpPort } from "../x402-model.js";
import { merchantFingerprint, merchantMove, merchantSnapshot, sealMerchant, type MerchantOperation } from "./model.js";
import { MerchantRepository } from "./repository.js";
import { MerchantOwner } from "./owner.js";
import { checkMerchantEnvelope, merchantCurrent, merchantReceipt, hexHash, type MerchantRpcPort } from "./rpc.js";
import { type MerchantCustodyPort } from "./custody.js";
import { merchantChallenge, merchantPrice, merchantProof, refuse } from "./protocol.js";
import { MERCHANT_AMOUNT, MERCHANT_OWNER, MERCHANT_URL } from "./pins.js";
export interface MerchantPorts {
    readonly rpc: MerchantRpcPort;
    readonly http: HttpPort;
    readonly custody?: MerchantCustodyPort;
    readonly approve?: (o: MerchantOperation) => Promise<void>;
    readonly now: () => Date;
}
export class MerchantService {
    readonly records: MerchantRepository;
    private readonly operations: OperationService;
    private readonly owner: MerchantOwner;
    constructor(private readonly state: StateStore, private readonly ports: MerchantPorts) { this.records = new MerchantRepository(state.root); this.operations = new OperationService(state); this.owner = new MerchantOwner(state, ports.now); }
    async prepare(input: {
        profile: string;
        maximumNativeFee: string;
        idempotencyKey: string;
    }): Promise<MerchantOperation> {
        const profile = canonicalProfile(input.profile), key = canonicalIdempotencyKey(input.idempotencyKey), maximumNativeFee = input.maximumNativeFee;
        if (!/^[1-9][0-9]*$/u.test(maximumNativeFee) || BigInt(maximumNativeFee) > 10n ** 18n)
            refuse("merchant_fee_ceiling");
        const profileHash = this.state.profileHash(profile), operationId = this.state.operationId(profile, key), idempotencyHash = this.state.idempotencyHash(key), requestHash = hashObject({ kind: "merchant_x402", profile, url: MERCHANT_URL, maximumNativeFee });
        await this.state.initialize();
        return this.state.withLocks(this.locks(profileHash, operationId, idempotencyHash), async () => {
            const existing = await this.operations.resolvePrepare({ kind: "merchant_x402", profileHash, operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "merchant_x402")
                    refuse("merchant_idempotency_kind");
                return existing.record;
            }
            const custody = await evmNativeCustody(this.state, profile);
            if (custody.walletAddress !== MERCHANT_OWNER)
                refuse("merchant_finite_owner");
            await assertExclusiveEvmRawSigner(this.state, MERCHANT_OWNER, profileHash);
            await this.operations.assertEvmAccountAvailable(profileHash, 4326, MERCHANT_OWNER);
            const policy = await this.owner.admit(profile), observation = await this.ports.http.get({ url: MERCHANT_URL }), frozen = merchantChallenge(observation), current = await merchantCurrent(this.ports.rpc);
            const createdAt = this.ports.now().toISOString();
            if (Date.parse(createdAt) - Date.parse(observation.observedAt) > 30000 || Date.parse(createdAt) < Date.parse(observation.observedAt))
                refuse("merchant_challenge_read_age");
            const envelope = { nonce: current.nonce, gas: current.gas, maxFeePerGas: current.maxFeePerGas, maxPriorityFeePerGas: current.maxPriorityFeePerGas, maximumNativeFee };
            checkMerchantEnvelope(current, envelope);
            if (BigInt(current.token) < BigInt(MERCHANT_AMOUNT))
                refuse("merchant_usdm_balance");
            const body = { schemaVersion: "apn.x402-merchant.v1" as const, kind: "merchant_x402" as const, operationId, profile, profileHash, idempotencyHash, requestHash, custody, frozen, envelope, policy, createdAt, expiresAt: new Date(Date.parse(createdAt) + 300000).toISOString(), state: "prepared" as const, terminal: false, signingAttempts: 0 as const, submissionAttempts: 0 as const, txHash: null, receipt: null, deliveryAttempts: [], events: [{ at: createdAt, state: "prepared" as const, previousHash: null, snapshotHash: merchantSnapshot({ state:"prepared", signingAttempts:0, submissionAttempts:0, txHash:null, receipt:null, deliveryAttempts:[] }), eventHash: hashObject({ at: createdAt, state: "prepared", previousHash: null, snapshotHash: merchantSnapshot({ state:"prepared", signingAttempts:0, submissionAttempts:0, txHash:null, receipt:null, deliveryAttempts:[] }) }) }] };
            const o = sealMerchant({ ...body, fingerprint: merchantFingerprint(body) });
            await this.records.persist(o);
            return o;
        });
    }
    async approve(id: string): Promise<MerchantOperation> {
        const found = await this.required(id);
        return this.state.withLocks(this.locks(found.profileHash, found.operationId, found.idempotencyHash), async () => {
            let o = await this.required(id);
            if (o.state !== "prepared" || o.signingAttempts !== 0 || o.submissionAttempts !== 0)
                refuse("merchant_once_only_approval");
            if (this.ports.approve === undefined || this.ports.custody === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "The pinned USDm payment requires foreground CLI confirmation.");
            await this.revalidate(o);
            await this.ports.approve(o);
            await this.revalidate(o);
            await this.owner.reserve(o);
            o = merchantMove(o, "signing_started", this.at(), { signingAttempts: 1 });
            await this.records.persist(o);
            await this.owner.follow(o, "unknown_finality");
            // No path after this durable fence may invoke custody again, including a crash before the signature returns.
            try {
                const raw = await this.ports.custody.sign(o), txHash = await this.ports.custody.verify(o, raw);
                await this.ports.custody.seal(o, raw);
                this.fresh(o);
                await this.owner.confirm(o);
                checkMerchantEnvelope(await merchantCurrent(this.ports.rpc), o.envelope);
                if (canonicalJson(merchantChallenge(await this.ports.http.get({url:MERCHANT_URL}))) !== canonicalJson(o.frozen)) refuse("merchant_challenge_changed_after_sealing");
                this.fresh(o);
                o = merchantMove(o, "submission_started", this.at(), { submissionAttempts: 1, txHash });
                await this.records.persist(o);
                const sent = hexHash(await this.ports.rpc.call("eth_sendRawTransaction", [raw], async () => { this.fresh(o); await this.owner.confirm(o); this.fresh(o); }, () => this.fresh(o)));
                if (sent !== txHash)
                    refuse("merchant_send_hash_mismatch");
            }
            catch {
                o = merchantMove(o, "unknown_finality", this.at());
                await this.records.persist(o);
                return o;
            }
            o = merchantMove(o, "unknown_finality", this.at());
            await this.records.persist(o);
            return await this.observeLocked(o, true);
        });
    }
    async observe(id: string, deliver = false): Promise<MerchantOperation> {
        const found = await this.required(id);
        return this.state.withLocks(this.locks(found.profileHash, found.operationId, found.idempotencyHash), async () => this.observeLocked(await this.required(id), deliver));
    }
    async status(id: string) { return await this.required(id); }
    private async observeLocked(o: MerchantOperation, deliver: boolean): Promise<MerchantOperation> {
        if (o.state === "delivered" || o.state === "reverted") {
            await this.owner.follow(o, o.state === "delivered" ? "finalized" : "failed_confirmed_revert");
            return o;
        }
        if (o.submissionAttempts !== 1 || o.txHash === null)
            refuse("merchant_observer_has_no_transaction_claim");
        if (o.receipt === null) {
            let receipt;
            try {
                receipt = await merchantReceipt(this.ports.rpc, o);
            }
            catch {
                return o;
            }
            if (receipt === null)
                return o;
            o = merchantMove(o, receipt.status === "success" ? "payment_finalized" : "reverted", this.at(), { receipt });
            await this.records.persist(o);
        }
        await this.owner.follow(o, o.receipt!.status === "success" ? "finalized" : "failed_confirmed_revert");
        if (o.receipt!.status !== "success" || !deliver)
            return o;
        if (o.deliveryAttempts.length % 2 === 1) {
            const dangling = o.deliveryAttempts.at(-1)!;
            o = merchantMove(o, "delivery_unknown", this.at(), { deliveryAttempts: [...o.deliveryAttempts, { at:this.at(), proofHash:dangling.proofHash, outcome:"unknown" }] });
            await this.records.persist(o);
        }
        // Only this explicit observer flag retries delivery. It always uses the original transaction, never pays again.
        if (o.deliveryAttempts.length >= 16)
            refuse("merchant_delivery_retry_limit");
        const proof = merchantProof(o.frozen, o.txHash!), proofHash = hashObject(proof), at = this.at();
        o = merchantMove(o, "delivery_unknown", at, { deliveryAttempts: [...o.deliveryAttempts, { at, proofHash, outcome: "started" }] });
        await this.records.persist(o);
        let response: Awaited<ReturnType<HttpPort["get"]>> | undefined;
        try {
            response = await this.ports.http.get({ url: MERCHANT_URL, paymentSignature: proof });
            const result = merchantPrice(response), bodyHash = hashObject(Buffer.from(response.bodyBytes).toString("base64"));
            o = merchantMove(o, "delivered", this.at(), { deliveryAttempts: [...o.deliveryAttempts, { at: this.at(), proofHash, outcome: "delivered", httpStatus: response.status, bodyHash, headers: response.rawHeaderPairs, result }] });
        }
        catch {
            o = merchantMove(o, "delivery_unknown", this.at(), { deliveryAttempts: [...o.deliveryAttempts, { at: this.at(), proofHash, outcome: "unknown", ...(response === undefined ? {} : { httpStatus: response.status, bodyHash: hashObject(Buffer.from(response.bodyBytes).toString("base64")), headers: response.rawHeaderPairs }) }] });
        }
        await this.records.persist(o);
        return o;
    }
    private async revalidate(o: MerchantOperation) {
        this.fresh(o);
        await this.owner.confirm(o);
        await this.operations.assertMerchantAccountAvailable(o);
        const current = await merchantCurrent(this.ports.rpc);
        checkMerchantEnvelope(current, o.envelope);
        const fresh = merchantChallenge(await this.ports.http.get({ url: MERCHANT_URL }));
        if (canonicalJson(fresh) !== canonicalJson(o.frozen))
            refuse("merchant_challenge_changed");
        this.fresh(o);
    }
    private fresh(o: MerchantOperation) { if (this.at() >= o.expiresAt || this.at().slice(0, 10) !== o.createdAt.slice(0, 10))
        refuse("merchant_local_deadline_expired"); }
    private at() { return this.ports.now().toISOString(); }
    private locks(profileHash: string, id: string, idempotencyHash: string) { return [`profile:${profileHash}`, `operation:${id}`, `operation:idempotency:${idempotencyHash}`, evmAddressLock(MERCHANT_OWNER)]; }
    private async required(id: string) { const o = await this.records.findOperation(canonicalOperationId(id)); if (o === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Pinned merchant operation was not found."); return o; }
}
