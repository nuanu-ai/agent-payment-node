import { validateMerchantFailures, type MerchantFailure } from "./failure.js";
import { validateMerchantFeeContext, type MerchantFeeContext } from "./mega-fee.js";
import type { Hex } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import type { EvmNativeCustody } from "../evm-native-custody.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { canonicalMerchantUrl, checkChallengeFor, refuse, type FrozenMerchantChallenge } from "./protocol.js";
import { merchantTerms } from "./terms.js";
import type { MerchantAssetPin } from "./asset-pins.js";
import { LEGACY_MERCHANT_MECHANISM, validMerchantAssetPin } from "./pins.js";
export interface MerchantEnvelope {
    readonly nonce: string;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNativeFee: string;
    readonly nativeFeeReserveWei?: string;
}
export type MerchantPhase = "prepared" | "signing_started" | "submission_started" | "unknown_finality" | "payment_finalized" | "delivery_unknown" | "delivered" | "reverted" | "retired_unsent";
export interface MerchantReceipt {
    readonly transactionHash: Hex;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly finality: "finalized";
    readonly status: "success" | "reverted";
    readonly evidenceHash: string;
    readonly networkFeeWei: string;
    readonly fullFee?: {readonly executionWei:string;readonly l1Wei:string;readonly operatorWei:string;readonly signedExecutionCapWei:string;readonly admissionEstimatedUpperWei:string;readonly payerDebit:{readonly before:string;readonly after:string;readonly aggregateDebit:string;readonly transactionHashes:readonly Hex[];readonly evidenceHash:string}};
    readonly canonical?: { readonly transactionIndex: string; readonly blockHeaderHash: string; readonly finalizedNumber: string; readonly finalizedHash: Hex; readonly finalizedHeaderHash: string };
}
export interface MerchantCanonicalObservation {
    readonly at: string;
    readonly result: "verified" | "mismatch" | "unavailable";
    readonly reason: string;
    readonly chain: "eip155:4326";
    readonly origin: "https://mainnet.megaeth.com";
    readonly priorReceiptHash: string;
    readonly deliveryCount: number;
    readonly priorDeliveryHash: string;
    readonly currentReceiptHash: string | null;
    readonly currentAnchors: NonNullable<MerchantReceipt["canonical"]> | null;
    readonly previousHash: string | null;
    readonly observationHash: string;
}
export interface MerchantEvent {
    readonly at: string;
    readonly state: MerchantPhase;
    readonly previousHash: string | null;
    readonly snapshotHash: string;
    readonly eventHash: string;
}
export interface MerchantOperation {
    /** v1: the x402engine Bitcoin-price lane (legacy mechanism, read and finish only). v2: any merchant (`url`, `asset`). */
    readonly schemaVersion: "apn.x402-merchant.v1" | "apn.x402-merchant.v2";
    readonly kind: "merchant_x402";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly custody: EvmNativeCustody;
    readonly frozen: FrozenMerchantChallenge;
    /** v2 only: the canonical merchant URL (`--url`) the challenge, proof and delivery use. */
    readonly url?: string;
    /** v2 only: the pinned asset the selected challenge row named, frozen as it was at prepare. */
    readonly asset?: MerchantAssetPin;
    readonly envelope: MerchantEnvelope;
    readonly policy: {
        readonly digest: string;
        readonly revision: number;
        readonly activationDigest: string;
    };
    readonly failures?: readonly MerchantFailure[];
    readonly retirementDigest?: string;
    readonly feeContext?: MerchantFeeContext;
    readonly effectBinding?: { readonly policyEndsAt: string; readonly nativeAmountAtomic: string };
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly state: MerchantPhase;
    readonly terminal: boolean;
    readonly signingAttempts: 0 | 1;
    readonly submissionAttempts: 0 | 1;
    readonly txHash: Hex | null;
    readonly receipt: MerchantReceipt | null;
    readonly deliveryAttempts: readonly {
        readonly at: string;
        readonly proofHash: string;
        readonly outcome: "started" | "unknown" | "delivered";
        readonly httpStatus?: number;
        readonly bodyHash?: string;
        readonly headers?: readonly (readonly [
            string,
            string
        ])[];
        readonly result?: Record<string, unknown>;
    }[];
    readonly events: readonly MerchantEvent[];
    readonly integrityHash: string;
    readonly canonicalObservations?: readonly MerchantCanonicalObservation[];
}
export function merchantFingerprint(o: Omit<MerchantOperation, "fingerprint" | "integrityHash">): string {
    return hashObject({ schemaVersion: o.schemaVersion, kind: o.kind, operationId: o.operationId, profile: o.profile, profileHash: o.profileHash,
        idempotencyHash: o.idempotencyHash, requestHash: o.requestHash, custody: o.custody, frozen: o.frozen, ...(o.url === undefined ? {} : { url: o.url }), ...(o.asset === undefined ? {} : { asset: o.asset }), envelope: o.envelope,...(o.feeContext===undefined?{}:{feeContext:o.feeContext}), policy: o.policy, ...(o.effectBinding === undefined ? {} : {effectBinding:o.effectBinding}), createdAt: o.createdAt, expiresAt: o.expiresAt });
}
export function sealMerchant(o: Omit<MerchantOperation, "integrityHash">): MerchantOperation { return validateMerchant({ ...o, integrityHash: hashObject(o) }); }
export function merchantSnapshot(o: Pick<MerchantOperation, "state" | "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts">): string { return hashObject({ state: o.state, signingAttempts: o.signingAttempts, submissionAttempts: o.submissionAttempts, txHash: o.txHash, receipt: o.receipt, deliveryAttempts: o.deliveryAttempts }); }
export function merchantMove(o: MerchantOperation, state: MerchantPhase, at: string, changes: Partial<Pick<MerchantOperation, "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts" | "retirementDigest">> = {}): MerchantOperation {
    const base = { at, state, snapshotHash: merchantSnapshot({ ...o, ...changes, state }), previousHash: o.events.at(-1)?.eventHash ?? null };
    const event = { ...base, eventHash: hashObject(base) };
    const { integrityHash: _, ...body } = o;
    return sealMerchant({ ...body, ...changes, state, terminal: state === "delivered" || state === "reverted" || state === "retired_unsent", events: [...o.events, event] });
}
export function validateMerchant(v: unknown): MerchantOperation {
    const v2 = isPlainRecord(v) && v.schemaVersion === "apn.x402-merchant.v2";
    if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "kind", "operationId", "profile", "profileHash", "idempotencyHash", "requestHash", "fingerprint", "custody", "frozen", ...(v2 ? ["url", "asset"] : []), "envelope", "policy", ...(v.failures===undefined?[]:["failures"]), ...(v.retirementDigest===undefined?[]:["retirementDigest"]), ...(v.feeContext===undefined?[]:["feeContext"]), ...(v.effectBinding === undefined ? [] : ["effectBinding"]), "createdAt", "expiresAt", "state", "terminal", "signingAttempts", "submissionAttempts", "txHash", "receipt", "deliveryAttempts", "events", "integrityHash", ...(v.canonicalObservations === undefined ? [] : ["canonicalObservations"])]))
        refuse("merchant_state_schema");
    const o = v as unknown as MerchantOperation, { integrityHash, ...body } = o;
    if (!["prepared", "signing_started", "submission_started", "unknown_finality", "payment_finalized", "delivery_unknown", "delivered", "reverted", "retired_unsent"].includes(o.state) || !exactKeys(o.policy as unknown as Record<string,unknown>, ["digest", "revision", "activationDigest"]) || o.schemaVersion !== "apn.x402-merchant.v1" && o.schemaVersion !== "apn.x402-merchant.v2" || o.kind !== "merchant_x402" || hashObject(body) !== integrityHash || merchantFingerprint(o) !== o.fingerprint ||
        ![o.operationId, o.profileHash, o.idempotencyHash, o.requestHash, o.fingerprint, o.policy?.digest, o.policy?.activationDigest].every(h => /^[a-f0-9]{64}$/u.test(h)) ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(o.profile) || !Number.isSafeInteger(o.policy.revision) || o.policy.revision < 1 ||
        o.terminal !== ["delivered", "reverted", "retired_unsent"].includes(o.state) || ![0, 1].includes(o.signingAttempts) || ![0, 1].includes(o.submissionAttempts) || o.submissionAttempts > o.signingAttempts)
        refuse("merchant_state_integrity");
    validateEvmNativeCustody(o.custody);
    // v2 binds its own URL and asset pin (as frozen at prepare, never the current registry); v1 the frozen legacy table.
    if (v2 && (typeof o.url !== "string" || !canonicalUrl(o.url) || !validMerchantAssetPin(o.asset)))
        refuse("merchant_state_binding");
    // The payer is the operation's own custody record for its profile (custody(profile) at prepare), never a fixed owner.
    if (o.custody.profileHash !== o.profileHash || canonicalJson(checkChallengeFor(merchantTerms(o), o.frozen.challenge)) !== canonicalJson(o.frozen))
        refuse("merchant_state_binding");
    if (!exactKeys(o.envelope as unknown as Record<string, unknown>, ["nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "maximumNativeFee", ...(o.envelope.nativeFeeReserveWei===undefined?[]:["nativeFeeReserveWei"])]) || !Object.values(o.envelope).every(a => /^(0|[1-9][0-9]*)$/u.test(a)) ||
        BigInt(o.envelope.nonce) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(o.envelope.gas) < 21000n || BigInt(o.envelope.maxPriorityFeePerGas) > BigInt(o.envelope.maxFeePerGas) ||
        BigInt(o.envelope.maximumNativeFee) < BigInt(o.envelope.gas) * BigInt(o.envelope.maxFeePerGas))
        refuse("merchant_state_envelope");
    if(o.feeContext!==undefined)validateMerchantFeeContext(o.feeContext,o.envelope,merchantTerms(o));
    if(o.envelope.nativeFeeReserveWei!==undefined&&(o.feeContext===undefined||BigInt(o.envelope.nativeFeeReserveWei)<BigInt(o.feeContext.admissionEstimatedUpper)||BigInt(o.envelope.nativeFeeReserveWei)>BigInt(o.envelope.maximumNativeFee)))refuse("merchant_native_reserve_binding");
    if(o.failures!==undefined)validateMerchantFailures(o.failures);
    if(o.retirementDigest!==undefined&&(!/^[a-f0-9]{64}$/u.test(o.retirementDigest)||o.state!=="retired_unsent")||o.state==="retired_unsent"&&(o.retirementDigest===undefined||o.signingAttempts!==1||o.submissionAttempts!==0||o.txHash!==null||o.receipt!==null||o.deliveryAttempts.length!==0))refuse("merchant_retirement_binding");
    if (o.effectBinding !== undefined && (!isPlainRecord(o.effectBinding) || !exactKeys(o.effectBinding,["policyEndsAt","nativeAmountAtomic"]) || !Number.isFinite(Date.parse(o.effectBinding.policyEndsAt)) || new Date(o.effectBinding.policyEndsAt).toISOString() !== o.effectBinding.policyEndsAt || o.effectBinding.nativeAmountAtomic !== (o.envelope.nativeFeeReserveWei??o.feeContext?.admissionEstimatedUpper??(BigInt(o.envelope.gas)*BigInt(o.envelope.maxFeePerGas)).toString()))) refuse("merchant_effect_binding");
    for (const t of [o.createdAt, o.expiresAt])
        if (!Number.isFinite(Date.parse(t)) || new Date(t).toISOString() !== t)
            refuse("merchant_state_time");
    if (Date.parse(o.expiresAt) - Date.parse(o.createdAt) !== 300000 || !Array.isArray(o.events) || !Array.isArray(o.deliveryAttempts))
        refuse("merchant_state_time_or_events");
    let previous: string | null = null, priorAt = o.createdAt;
    for (const event of o.events) {
        const { eventHash, ...b } = event;
        if (eventHash !== hashObject(b) || b.previousHash !== previous || !/^[a-f0-9]{64}$/u.test(b.snapshotHash) || !Number.isFinite(Date.parse(b.at)) || b.at < priorAt)
            refuse("merchant_event_chain");
        previous = eventHash; priorAt = b.at;
    }
    if (o.events.at(-1)?.snapshotHash !== merchantSnapshot(o) || o.events.at(-1)?.state !== o.state || o.txHash !== null && !/^0x[0-9a-f]{64}$/u.test(o.txHash) || o.submissionAttempts === 1 && o.txHash === null)
        refuse("merchant_state_attempt");
    if (o.state === "prepared" && (o.signingAttempts !== 0 || o.submissionAttempts !== 0 || o.txHash !== null || o.receipt !== null || o.deliveryAttempts.length !== 0) || o.state === "signing_started" && (o.signingAttempts !== 1 || o.submissionAttempts !== 0) || ["submission_started", "payment_finalized", "delivery_unknown", "delivered", "reverted"].includes(o.state) && o.submissionAttempts !== 1 || o.state === "unknown_finality" && o.signingAttempts !== 1)
        refuse("merchant_phase_attempt_binding");
    if (o.receipt !== null && (!exactKeys(o.receipt as unknown as Record<string,unknown>, ["transactionHash", "blockNumber", "blockHash", "finality", "status", "evidenceHash", "networkFeeWei", ...(o.receipt.fullFee===undefined?[]:["fullFee"]), ...(o.receipt.canonical === undefined ? [] : ["canonical"])]) || !/^[0-9]+$/u.test(o.receipt.blockNumber) || !/^0x[0-9a-f]{64}$/u.test(o.receipt.blockHash) || !/^(0|[1-9][0-9]*)$/u.test(o.receipt.networkFeeWei) || !["success", "reverted"].includes(o.receipt.status) || o.receipt.transactionHash !== o.txHash || o.receipt.finality !== "finalized" || !/^[a-f0-9]{64}$/u.test(o.receipt.evidenceHash)))
        refuse("merchant_state_receipt");
    if(o.receipt?.fullFee!==undefined){
      const f=o.receipt.fullFee,d=f.payerDebit;
      if(o.feeContext===undefined||!isPlainRecord(f)||!exactKeys(f,["executionWei","l1Wei","operatorWei","signedExecutionCapWei","admissionEstimatedUpperWei","payerDebit"])||!isPlainRecord(d)||!exactKeys(d,["before","after","aggregateDebit","transactionHashes","evidenceHash"])||
        ![f.executionWei,f.l1Wei,f.operatorWei,f.signedExecutionCapWei,f.admissionEstimatedUpperWei,d.before,d.after,d.aggregateDebit].every(x=>/^(0|[1-9][0-9]{0,77})$/u.test(x))||o.feeContext.schemaVersion==="apn.merchant-mega-fee.v1"&&f.operatorWei!=="0"||f.signedExecutionCapWei!==o.feeContext.executionUpper||f.admissionEstimatedUpperWei!==o.feeContext.admissionEstimatedUpper||
        BigInt(f.executionWei)+BigInt(f.l1Wei)+BigInt(f.operatorWei)!==BigInt(o.receipt.networkFeeWei)||BigInt(o.receipt.networkFeeWei)>BigInt(o.envelope.nativeFeeReserveWei??f.admissionEstimatedUpperWei)||BigInt(d.before)-BigInt(d.after)!==BigInt(d.aggregateDebit)||BigInt(d.aggregateDebit)<BigInt(o.receipt.networkFeeWei)||
        !/^[a-f0-9]{64}$/u.test(d.evidenceHash)||!Array.isArray(d.transactionHashes)||d.transactionHashes.length<1||d.transactionHashes.length>8||new Set(d.transactionHashes).size!==d.transactionHashes.length||d.transactionHashes.filter(h=>h===o.txHash).length!==1||d.transactionHashes.some(h=>!/^0x[a-f0-9]{64}$/u.test(h)))refuse("merchant_full_fee_receipt_binding");
    }
    if (o.receipt?.canonical !== undefined) {
        const c = o.receipt.canonical;
        if (!isPlainRecord(c) || !exactKeys(c, ["transactionIndex", "blockHeaderHash", "finalizedNumber", "finalizedHash", "finalizedHeaderHash"]) ||
            !/^(0|[1-9][0-9]*)$/u.test(c.transactionIndex) || !/^(0|[1-9][0-9]*)$/u.test(c.finalizedNumber) ||
            ![c.blockHeaderHash, c.finalizedHeaderHash].every(h => /^[a-f0-9]{64}$/u.test(h)) || !/^0x[0-9a-f]{64}$/u.test(c.finalizedHash) || BigInt(c.finalizedNumber) < BigInt(o.receipt.blockNumber)) refuse("merchant_canonical_receipt_shape");
    }
    if (["payment_finalized", "delivery_unknown", "delivered"].includes(o.state) && o.receipt?.status !== "success" || o.state === "reverted" && o.receipt?.status !== "reverted" || o.state === "delivered" && o.deliveryAttempts.at(-1)?.outcome !== "delivered")
        refuse("merchant_state_completion");
    if (o.deliveryAttempts.length > 16)
        refuse("merchant_delivery_attempt_bound");
    for (let i = 0; i < o.deliveryAttempts.length; i++) {
        const a = o.deliveryAttempts[i]!;
        if (!/^[a-f0-9]{64}$/u.test(a.proofHash) || !Number.isFinite(Date.parse(a.at)) || (i % 2 === 0 ? a.outcome !== "started" : a.outcome === "started" || a.proofHash !== o.deliveryAttempts[i - 1]!.proofHash))
            refuse("merchant_delivery_append_shape");
    }
    if (o.canonicalObservations !== undefined) {
        if (!Array.isArray(o.canonicalObservations) || o.canonicalObservations.length < 1 || o.canonicalObservations.length > 128 || o.receipt === null) refuse("merchant_canonical_audit_shape");
        let previousAudit: string | null = null, auditAt = o.createdAt, priorAuditBody: string | null = null;
        for (const entry of o.canonicalObservations) {
            if (!isPlainRecord(entry) || !exactKeys(entry, ["at", "result", "reason", "chain", "origin", "priorReceiptHash", "deliveryCount", "priorDeliveryHash", "currentReceiptHash", "currentAnchors", "previousHash", "observationHash"])) refuse("merchant_canonical_audit_shape");
            const a = entry as unknown as MerchantCanonicalObservation;
            const { observationHash, ...body } = a;
            if (observationHash !== hashObject(body) || a.previousHash !== previousAudit || !["verified", "mismatch", "unavailable"].includes(a.result) ||
                typeof a.reason !== "string" || !/^[a-z0-9_]{1,96}$/u.test(a.reason) || a.chain !== "eip155:4326" || a.origin !== "https://mainnet.megaeth.com" ||
                a.priorReceiptHash !== hashObject(o.receipt) || !Number.isSafeInteger(a.deliveryCount) || a.deliveryCount < 0 || a.deliveryCount > o.deliveryAttempts.length ||
                a.priorDeliveryHash !== hashObject(o.deliveryAttempts.slice(0, a.deliveryCount)) || !Number.isFinite(Date.parse(a.at)) || new Date(a.at).toISOString() !== a.at || a.at < auditAt ||
                a.currentReceiptHash !== null && !/^[a-f0-9]{64}$/u.test(a.currentReceiptHash) || a.result === "verified" && (a.currentReceiptHash === null || a.currentAnchors === null)) refuse("merchant_canonical_audit_binding");
            if (a.currentAnchors !== null) {
                const c = a.currentAnchors;
                if (!isPlainRecord(c as unknown) || !exactKeys(c as unknown as Record<string, unknown>, ["transactionIndex", "blockHeaderHash", "finalizedNumber", "finalizedHash", "finalizedHeaderHash"]) ||
                    !/^(0|[1-9][0-9]*)$/u.test(c.transactionIndex) || !/^(0|[1-9][0-9]*)$/u.test(c.finalizedNumber) ||
                    ![c.blockHeaderHash, c.finalizedHeaderHash].every(h => /^[a-f0-9]{64}$/u.test(h)) || !/^0x[0-9a-f]{64}$/u.test(c.finalizedHash)) refuse("merchant_canonical_audit_anchor");
            }
            const { at: _, previousHash: __, observationHash: ___, ...semantic } = a;
            const semanticHash = hashObject(semantic);
            if (semanticHash === priorAuditBody) refuse("merchant_canonical_audit_duplicate");
            priorAuditBody = semanticHash;
            previousAudit = observationHash; auditAt = a.at;
        }
    }
    return o;
}
function canonicalUrl(url: string): boolean { try { return canonicalMerchantUrl(url) === url; } catch { return false; } }
export function publicMerchant(o: MerchantOperation) {
    validateMerchant(o);
    const t = merchantTerms(o);
    return { kind: o.kind, operationId: o.operationId, state: o.state, terminal: o.terminal,
        mechanism: t.mechanism.provider, provider: { id: t.mechanism.provider, reference: t.mechanism.reference, protocolSnapshot: t.legacy ? "vendor/x402engine-transfer-proof/protocol-v1.json" : null, assetTransferMethod:"erc20-transfer-proof", eip3009:false, gasless:false },
        url: t.url, payer: t.payer, payee: t.payee, asset: { chain: t.chain, token: t.token, symbol: t.asset.symbol, decimals: t.asset.decimals }, legacyMechanism: t.legacy ? LEGACY_MERCHANT_MECHANISM : null, paymentFinalized: o.receipt?.status === "success", merchantDelivered: o.state === "delivered", transactionHash: o.txHash,
        challengeHash: o.frozen.challengeHash, expiresAt: o.expiresAt, amountAtomic: o.frozen.accepted.amount, feeCeilingWei: o.envelope.maximumNativeFee,...(o.feeContext===undefined?{}:{feeBudgetSemantics:"pre_submission_full_fee_estimate_not_onchain_l1_cap",signedExecutionCapWei:o.feeContext.executionUpper,admissionEstimatedUpperWei:o.feeContext.admissionEstimatedUpper,l1EstimatedUpperWei:o.feeContext.l1EstimatedUpper,operatorEstimatedUpperWei:o.feeContext.operatorEstimatedUpper,feeRule:o.feeContext.schemaVersion}),
        failures:o.failures??[],retirementDigest:o.retirementDigest??null,retirementReceipt:o.state==="retired_unsent"?{kind:"merchant_unsent_retirement",tombstoneDigest:o.retirementDigest,consumedAtomic:"0",payment:false,delivery:false}:null,...(o.envelope.nativeFeeReserveWei===undefined?{}:{nativeFeeReserveWei:o.envelope.nativeFeeReserveWei}),
        currentCanonicalProof: o.canonicalObservations?.at(-1) ?? null, result: o.state === "delivered" ? o.deliveryAttempts.at(-1)?.result : null, receipt: o.receipt };
}
