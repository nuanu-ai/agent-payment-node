/** Source-effect journal for the Circle V2 Base source burn. Every released version wrote only v3
 * (`stageLiveCircle`): a caller-supplied Circle transport claim and the exact source envelope.
 * Stored claims are not origin authentication; only the concrete service may sign or send.
 */
import { hashObject, sha256 } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import { z } from "zod";
import { addressSchema, hashSchema, hexSchema, isoSchema, uintSchema, wordSchema } from "./schema.js";
import { bridgeFailure } from "./validation.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "./circle-v2-source-receipt.js";
const pair = z.literal("base_usdc_to_solana_usdc_circle_cctp_v2");
const call = z.strictObject({ chainId: z.literal(8453), from: addressSchema, to: addressSchema,
    valueAtomic: uintSchema, data: hexSchema, dataSha256: hashSchema,
    type: z.literal("eip1559"), nonceAtomic: uintSchema, gasLimitAtomic: uintSchema,
    maxFeePerGasAtomic: uintSchema, maxPriorityFeePerGasAtomic: uintSchema,
    accessList: z.tuple([]) });
const liveCircleProof = z.strictObject({ kind: z.literal("circle_v2_live_transport_v1"),
    circleOrigin: z.literal("https://iris-api.circle.com"), rpcOrigin: z.string().url(),
    quoteHash: hashSchema, validationHash: hashSchema, sourceBlockHash: wordSchema,
    preparationDigest: hashSchema, payer: addressSchema, recipientOwner: z.string().min(32).max(44),
    recipientAta: z.string().min(32).max(44), feeTotalAtomic: uintSchema });
const phase = z.enum(["staged_untrusted", "signing_started", "sealed", "submitting", "submitted_pending", "unknown_finality"]);
const signedHex = z.string().regex(/^0x(?:[a-f0-9]{2})*$/u).max(32_770);
const snapshot = z.strictObject({ phase, signedTransaction: signedHex.nullable(), transactionHash: wordSchema.nullable(),
    nonceAtomic: uintSchema.nullable(), submissionAttempts: z.union([z.literal(0), z.literal(1)]),
    safeSourceProof: z.null(), reason: z.string().max(128).nullable() });
const entry = z.strictObject({ ...snapshot.shape, at: isoSchema, previousHash: hashSchema, transitionHash: hashSchema });
const schemaV3 = z.strictObject({ schemaVersion: z.literal("apn.non-evm-source-journal.v3"),
    kind: z.literal("non_evm_source_journal"), executionAdmitted: z.literal(true),
    profileHash: hashSchema, operationId: hashSchema, draftIntegrityHash: hashSchema,
    route: pair, sourceCall: call, maxSourceNativeDebitWei: uintSchema, admissionProof: liveCircleProof, createdAt: isoSchema,
    protocolInputHash: hashSchema, ...snapshot.shape, transitions: z.array(entry).min(1).max(32), integrityHash: hashSchema });
function corrupt() { return bridgeFailure("APN_STATE_CORRUPT", "non_evm_source_journal"); }
function blocked() { return bridgeFailure("APN_OPERATION_BLOCKED", "non_evm_source_transition_blocked"); }
function snapshotOf(j) {
    return { phase: j.phase, signedTransaction: j.signedTransaction, transactionHash: j.transactionHash,
        nonceAtomic: j.nonceAtomic, submissionAttempts: j.submissionAttempts,
        safeSourceProof: j.safeSourceProof, reason: j.reason };
}
const edges = {
    staged_untrusted: ["signing_started"], signing_started: ["sealed"], sealed: ["submitting"],
    submitting: ["submitted_pending", "unknown_finality"], submitted_pending: ["unknown_finality"], unknown_finality: [],
};
function checkSigned(j, raw, nonce) {
    let tx;
    try {
        tx = parseTransaction(raw);
    }
    catch {
        corrupt();
    }
    const c = j.sourceCall, s = tx.s === undefined ? 0n : BigInt(tx.s);
    if (tx.type !== "eip1559" || tx.chainId !== 8453 || tx.to?.toLowerCase() !== c.to.toLowerCase() ||
        (tx.data ?? "0x") !== c.data || (tx.value ?? 0n).toString() !== c.valueAtomic ||
        tx.nonce?.toString() !== c.nonceAtomic || nonce !== c.nonceAtomic ||
        tx.gas?.toString() !== c.gasLimitAtomic || tx.maxFeePerGas?.toString() !== c.maxFeePerGasAtomic ||
        (tx.maxPriorityFeePerGas ?? 0n).toString() !== c.maxPriorityFeePerGasAtomic ||
        (tx.accessList ?? []).length !== 0 || tx.r === undefined || tx.s === undefined || s <= 0n ||
        s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
        (tx.yParity !== 0 && tx.yParity !== 1) ||
        serializeTransaction(tx, { r: tx.r, s: tx.s, yParity: tx.yParity }) !== raw)
        corrupt();
    return keccak256(raw);
}
export function validateNonEvmSourceJournal(value) {
    const p = schemaV3.safeParse(value);
    if (!p.success)
        corrupt();
    const j = p.data, { integrityHash, ...body } = j;
    if (hashObject(body) !== integrityHash || j.sourceCall.dataSha256 !== sha256(Buffer.from(j.sourceCall.data.slice(2), "hex")) ||
        BigInt(j.sourceCall.gasLimitAtomic) < 1n || BigInt(j.sourceCall.maxFeePerGasAtomic) < 1n ||
        BigInt(j.sourceCall.maxPriorityFeePerGasAtomic) > BigInt(j.sourceCall.maxFeePerGasAtomic) ||
        BigInt(j.sourceCall.gasLimitAtomic) * BigInt(j.sourceCall.maxFeePerGasAtomic) +
            BigInt(j.sourceCall.valueAtomic) > BigInt(j.maxSourceNativeDebitWei) ||
        j.sourceCall.to !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || !j.sourceCall.data.startsWith("0xc62fa55e") ||
        j.admissionProof.payer !== j.sourceCall.from || j.admissionProof.sourceBlockHash.length !== 66)
        corrupt();
    let prior;
    for (const e of j.transitions) {
        const { transitionHash, ...content } = e;
        if (hashObject(content) !== transitionHash || e.previousHash !== (prior?.transitionHash ?? j.draftIntegrityHash))
            corrupt();
        if (prior === undefined) {
            if (e.phase !== "staged_untrusted" || e.at !== j.createdAt)
                corrupt();
        }
        else if (!edges[prior.phase].includes(e.phase) || e.at < prior.at)
            corrupt();
        if (e.submissionAttempts !== (e.phase === "staged_untrusted" || e.phase === "signing_started" || e.phase === "sealed" ? 0 : 1))
            corrupt();
        if (e.phase === "staged_untrusted" || e.phase === "signing_started") {
            if (e.signedTransaction !== null || e.transactionHash !== null || e.nonceAtomic !== null)
                corrupt();
        }
        else {
            if (e.signedTransaction === null || e.transactionHash === null || e.nonceAtomic === null ||
                checkSigned(j, e.signedTransaction, e.nonceAtomic) !== e.transactionHash)
                corrupt();
        }
        if (prior !== undefined && prior.phase !== "staged_untrusted" && prior.phase !== "signing_started" &&
            (prior.signedTransaction !== e.signedTransaction || prior.transactionHash !== e.transactionHash || prior.nonceAtomic !== e.nonceAtomic))
            corrupt();
        prior = e;
    }
    if (prior === undefined || hashObject(snapshotOf(j)) !== hashObject(snapshotOf(prior)))
        corrupt();
    return j;
}
function build(binding) {
    const initial = { phase: "staged_untrusted", signedTransaction: null, transactionHash: null,
        nonceAtomic: null, submissionAttempts: 0, safeSourceProof: null, reason: null };
    const first = { ...initial, at: binding.createdAt, previousHash: binding.draftIntegrityHash };
    const value = { schemaVersion: "apn.non-evm-source-journal.v3", kind: "non_evm_source_journal",
        executionAdmitted: true, ...binding, ...initial,
        transitions: [{ ...first, transitionHash: hashObject(first) }] };
    return validateNonEvmSourceJournal({ ...value, integrityHash: hashObject(value) });
}
function advance(j, next, at) {
    if (!edges[j.phase].includes(next.phase))
        blocked();
    const stamp = isoSchema.safeParse(at);
    if (!stamp.success || at < j.transitions.at(-1).at)
        blocked();
    const step = { ...next, at, previousHash: j.transitions.at(-1).transitionHash };
    const { integrityHash: _old, ...base } = j;
    const updated = { ...base, ...next, transitions: [...j.transitions, { ...step, transitionHash: hashObject(step) }] };
    return validateNonEvmSourceJournal({ ...updated, integrityHash: hashObject(updated) });
}
/** All mutations lock the exact draft identity and compare the expected record hash. */
export class NonEvmSourceJournalRepository extends SecureStateStore {
    path(profileHash, operationId) {
        stateIdentifier(profileHash, "profile hash");
        stateIdentifier(operationId, "operation ID");
        return `non-evm-source-journals/${profileHash}/${operationId}.json`;
    }
    async load(profileHash, operationId) {
        const raw = await this.readJson(this.path(profileHash, operationId));
        if (raw === null)
            return null;
        const j = validateNonEvmSourceJournal(raw);
        if (j.profileHash !== profileHash || j.operationId !== operationId)
            corrupt();
        return j;
    }
    reservationPath(j) {
        const key = sha256(`non-evm-source-reservation\0${j.profileHash}\0${j.sourceCall.from}\0${j.sourceCall.nonceAtomic}`);
        return `non-evm-source-reservations/${j.profileHash}/${key}.json`;
    }
    async reserve(j, transactionHash) {
        const path = this.reservationPath(j), prior = await this.readJson(path);
        const identity = { profileHash: j.profileHash, operationId: j.operationId,
            draftIntegrityHash: j.draftIntegrityHash, sender: j.sourceCall.from,
            nonceAtomic: j.sourceCall.nonceAtomic, transactionHash, protocolInputHash: j.protocolInputHash };
        const record = { ...identity, integrityHash: hashObject(identity) };
        if (prior !== null) {
            if (hashObject(prior) !== hashObject(record))
                blocked();
            return;
        }
        await this.ensureDirectory(`non-evm-source-reservations/${j.profileHash}`);
        await this.writeJson(path, record);
    }
    async assertReservation(j) {
        if (j.transactionHash === null)
            corrupt();
        const prior = await this.readJson(this.reservationPath(j));
        const identity = { profileHash: j.profileHash, operationId: j.operationId,
            draftIntegrityHash: j.draftIntegrityHash, sender: j.sourceCall.from,
            nonceAtomic: j.sourceCall.nonceAtomic, transactionHash: j.transactionHash, protocolInputHash: j.protocolInputHash };
        if (prior === null || hashObject(prior) !== hashObject({ ...identity, integrityHash: hashObject(identity) }))
            corrupt();
    }
    /** Records structural live-admission claims. This repository cannot authenticate network origin or authorize a source effect. */
    async stageLiveCircle(binding) {
        if (binding.admissionProof.kind !== "circle_v2_live_transport_v1")
            blocked();
        return this.stageBuilt(build(binding));
    }
    async stageBuilt(j) {
        await this.initialize();
        return this.withLocks([`profile:${j.profileHash}`, `operation:${j.operationId}`], async () => {
            const prior = await this.load(j.profileHash, j.operationId);
            if (prior !== null) {
                if (prior.schemaVersion !== j.schemaVersion || prior.protocolInputHash !== j.protocolInputHash ||
                    prior.draftIntegrityHash !== j.draftIntegrityHash || prior.route !== j.route ||
                    hashObject(prior.sourceCall) !== hashObject(j.sourceCall) ||
                    hashObject(prior.admissionProof) !== hashObject(j.admissionProof) || prior.createdAt !== j.createdAt ||
                    prior.maxSourceNativeDebitWei !== j.maxSourceNativeDebitWei)
                    corrupt();
                return prior;
            }
            await this.ensureDirectory(`non-evm-source-journals/${j.profileHash}`);
            await this.writeJson(this.path(j.profileHash, j.operationId), j);
            return j;
        });
    }
    async change(profileHash, operationId, expectedHash, update) {
        await this.initialize();
        return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            const prior = await this.load(profileHash, operationId);
            if (prior === null || prior.integrityHash !== expectedHash)
                blocked();
            const next = await update(prior);
            await this.writeJson(this.path(profileHash, operationId), next);
            return next;
        });
    }
    async signingStarted(profileHash, operationId, expectedHash, at) {
        return this.change(profileHash, operationId, expectedHash, j => advance(j, { ...snapshotOf(j), phase: "signing_started" }, at));
    }
    async seal(profileHash, operationId, expectedHash, raw, nonceAtomic, at) {
        return this.change(profileHash, operationId, expectedHash, async (j) => {
            if (j.phase !== "signing_started" || !uintSchema.safeParse(nonceAtomic).success)
                blocked();
            const hash = checkSigned(j, raw, nonceAtomic);
            let signer;
            try {
                signer = await recoverTransactionAddress({ serializedTransaction: raw });
            }
            catch {
                corrupt();
            }
            if (signer.toLowerCase() !== j.sourceCall.from.toLowerCase())
                corrupt();
            await this.reserve(j, hash);
            return advance(j, { ...snapshotOf(j), phase: "sealed", signedTransaction: raw, transactionHash: hash, nonceAtomic }, at);
        });
    }
    /** Commit the sole attempt before a future adapter may send. No send or retry method exists here. */
    async committingSubmission(profileHash, operationId, expectedHash, at) {
        return this.change(profileHash, operationId, expectedHash, async (j) => {
            await this.assertReservation(j);
            return advance(j, { ...snapshotOf(j), phase: "submitting", submissionAttempts: 1 }, at);
        });
    }
    async observePending(profileHash, operationId, expectedHash, at) {
        return this.change(profileHash, operationId, expectedHash, j => advance(j, { ...snapshotOf(j), phase: "submitted_pending" }, at));
    }
    async observeUnknown(profileHash, operationId, expectedHash, reason, at) {
        return this.change(profileHash, operationId, expectedHash, j => advance(j, { ...snapshotOf(j), phase: "unknown_finality", safeSourceProof: null, reason }, at));
    }
}
//# sourceMappingURL=non-evm-source-journal.js.map