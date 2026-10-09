import type { Hex } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import type { EvmNativeCustody } from "../evm-native-custody.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { checkMerchantChallenge, refuse, type FrozenMerchantChallenge } from "./protocol.js";
import { MERCHANT_OWNER } from "./pins.js";
export interface MerchantEnvelope {
    readonly nonce: string;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNativeFee: string;
}
export type MerchantPhase = "prepared" | "signing_started" | "submission_started" | "unknown_finality" | "payment_finalized" | "delivery_unknown" | "delivered" | "reverted";
export interface MerchantReceipt {
    readonly transactionHash: Hex;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly finality: "finalized";
    readonly status: "success" | "reverted";
    readonly evidenceHash: string;
    readonly networkFeeWei: string;
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
    readonly schemaVersion: "apn.x402-merchant.v1";
    readonly kind: "merchant_x402";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly custody: EvmNativeCustody;
    readonly frozen: FrozenMerchantChallenge;
    readonly envelope: MerchantEnvelope;
    readonly policy: {
        readonly digest: string;
        readonly revision: number;
        readonly activationDigest: string;
    };
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
        idempotencyHash: o.idempotencyHash, requestHash: o.requestHash, custody: o.custody, frozen: o.frozen, envelope: o.envelope, policy: o.policy, createdAt: o.createdAt, expiresAt: o.expiresAt });
}
export function sealMerchant(o: Omit<MerchantOperation, "integrityHash">): MerchantOperation { return validateMerchant({ ...o, integrityHash: hashObject(o) }); }
export function merchantSnapshot(o: Pick<MerchantOperation, "state" | "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts">): string { return hashObject({ state: o.state, signingAttempts: o.signingAttempts, submissionAttempts: o.submissionAttempts, txHash: o.txHash, receipt: o.receipt, deliveryAttempts: o.deliveryAttempts }); }
export function merchantMove(o: MerchantOperation, state: MerchantPhase, at: string, changes: Partial<Pick<MerchantOperation, "signingAttempts" | "submissionAttempts" | "txHash" | "receipt" | "deliveryAttempts">> = {}): MerchantOperation {
    const base = { at, state, snapshotHash: merchantSnapshot({ ...o, ...changes, state }), previousHash: o.events.at(-1)?.eventHash ?? null };
    const event = { ...base, eventHash: hashObject(base) };
    const { integrityHash: _, ...body } = o;
    return sealMerchant({ ...body, ...changes, state, terminal: state === "delivered" || state === "reverted", events: [...o.events, event] });
}
export function validateMerchant(v: unknown): MerchantOperation {
    if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "kind", "operationId", "profile", "profileHash", "idempotencyHash", "requestHash", "fingerprint", "custody", "frozen", "envelope", "policy", "createdAt", "expiresAt", "state", "terminal", "signingAttempts", "submissionAttempts", "txHash", "receipt", "deliveryAttempts", "events", "integrityHash", ...(v.canonicalObservations === undefined ? [] : ["canonicalObservations"])]))
        refuse("merchant_state_schema");
    const o = v as unknown as MerchantOperation, { integrityHash, ...body } = o;
    if (!["prepared", "signing_started", "submission_started", "unknown_finality", "payment_finalized", "delivery_unknown", "delivered", "reverted"].includes(o.state) || !exactKeys(o.policy as unknown as Record<string,unknown>, ["digest", "revision", "activationDigest"]) || o.schemaVersion !== "apn.x402-merchant.v1" || o.kind !== "merchant_x402" || hashObject(body) !== integrityHash || merchantFingerprint(o) !== o.fingerprint ||
        ![o.operationId, o.profileHash, o.idempotencyHash, o.requestHash, o.fingerprint, o.policy?.digest, o.policy?.activationDigest].every(h => /^[a-f0-9]{64}$/u.test(h)) ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(o.profile) || !Number.isSafeInteger(o.policy.revision) || o.policy.revision < 1 ||
        o.terminal !== ["delivered", "reverted"].includes(o.state) || ![0, 1].includes(o.signingAttempts) || ![0, 1].includes(o.submissionAttempts) || o.submissionAttempts > o.signingAttempts)
        refuse("merchant_state_integrity");
    validateEvmNativeCustody(o.custody);
    if (o.custody.walletAddress !== MERCHANT_OWNER || o.custody.profileHash !== o.profileHash || canonicalJson(checkMerchantChallenge(o.frozen.challenge)) !== canonicalJson(o.frozen))
        refuse("merchant_state_binding");
    if (!exactKeys(o.envelope as unknown as Record<string, unknown>, ["nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "maximumNativeFee"]) || !Object.values(o.envelope).every(a => /^(0|[1-9][0-9]*)$/u.test(a)) ||
        BigInt(o.envelope.nonce) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(o.envelope.gas) < 21000n || BigInt(o.envelope.maxPriorityFeePerGas) > BigInt(o.envelope.maxFeePerGas) ||
        BigInt(o.envelope.maximumNativeFee) < BigInt(o.envelope.gas) * BigInt(o.envelope.maxFeePerGas))
        refuse("merchant_state_envelope");
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
    if (o.receipt !== null && (!exactKeys(o.receipt as unknown as Record<string,unknown>, ["transactionHash", "blockNumber", "blockHash", "finality", "status", "evidenceHash", "networkFeeWei", ...(o.receipt.canonical === undefined ? [] : ["canonical"])]) || !/^[0-9]+$/u.test(o.receipt.blockNumber) || !/^0x[0-9a-f]{64}$/u.test(o.receipt.blockHash) || !/^(0|[1-9][0-9]*)$/u.test(o.receipt.networkFeeWei) || !["success", "reverted"].includes(o.receipt.status) || o.receipt.transactionHash !== o.txHash || o.receipt.finality !== "finalized" || !/^[a-f0-9]{64}$/u.test(o.receipt.evidenceHash)))
        refuse("merchant_state_receipt");
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
export function publicMerchant(o: MerchantOperation) {
    validateMerchant(o);
    return { kind: o.kind, operationId: o.operationId, state: o.state, terminal: o.terminal,
        mechanism: "x402engine-erc20-transfer-proof", provider: { id:"x402engine-erc20-transfer-proof", reference:"megaeth-usdm-crypto-price-v1", protocolSnapshot:"vendor/x402engine-transfer-proof/protocol-v1.json", assetTransferMethod:"erc20-transfer-proof", eip3009:false, gasless:false }, paymentFinalized: o.receipt?.status === "success", merchantDelivered: o.state === "delivered", transactionHash: o.txHash,
        challengeHash: o.frozen.challengeHash, expiresAt: o.expiresAt, amountAtomic: o.frozen.accepted.amount, feeCeilingWei: o.envelope.maximumNativeFee,
        currentCanonicalProof: o.canonicalObservations?.at(-1) ?? null, result: o.state === "delivered" ? o.deliveryAttempts.at(-1)?.result : null, receipt: o.receipt };
}
