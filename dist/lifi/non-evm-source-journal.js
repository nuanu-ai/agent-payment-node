/** Isolated source-effect journal. Admission proof is synthetic and never grants execution authority.
 * The draft freezes calldata but has no nonce or EIP-1559 fee envelope. Those values are
 * frozen here under a synthetic, untrusted binding; its draft checksum does not validate them.
 * No route, custody, transport, or CLI imports this module.
 */
import { hashObject, sha256 } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import { z } from "zod";
import { addressSchema, hashSchema, hexSchema, isoSchema, uintSchema, wordSchema } from "./schema.js";
import { bridgeFailure, BRIDGE_DIAMOND } from "./validation.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "./circle-v2-source-receipt.js";
const pair = z.enum(["base_usdc_to_solana_usdc_circle_cctp_v2", "base_usdc_to_tron_usdt_lifi_near_intents"]);
const call = z.strictObject({ chainId: z.literal(8453), from: addressSchema, to: addressSchema,
    valueAtomic: uintSchema, data: hexSchema, dataSha256: hashSchema,
    type: z.literal("eip1559"), nonceAtomic: uintSchema, gasLimitAtomic: uintSchema,
    maxFeePerGasAtomic: uintSchema, maxPriorityFeePerGasAtomic: uintSchema,
    accessList: z.tuple([]) });
const proof = z.strictObject({ kind: z.literal("synthetic_untrusted"), claimedValidationHash: hashSchema,
    note: z.string().min(1).max(256) });
const safe = z.strictObject({ provenance: z.literal("synthetic_untrusted"), transactionHash: wordSchema, status: z.enum(["success", "reverted"]),
    blockNumberAtomic: uintSchema, blockHash: wordSchema, safeBlockNumberAtomic: uintSchema,
    safeBlockHash: wordSchema, observedAt: isoSchema });
const rpcObservedSafe = z.strictObject({ provenance: z.literal("rpc_observed_untrusted_circle_v2_base_source_v1"),
    transactionHash: wordSchema, status: z.enum(["success", "reverted"]),
    blockNumberAtomic: uintSchema, blockHash: wordSchema, safeBlockNumberAtomic: uintSchema,
    safeBlockHash: wordSchema, observedAt: isoSchema, rpcOrigin: z.string().url(),
    logsHash: hashSchema, receiptHash: hashSchema, protocolInputDigest: hashSchema,
    protocolProofHash: hashSchema.nullable(), executionAdmitted: z.literal(false), bridgeCompletion: z.literal(false) });
const rpcObservedNearSafe = rpcObservedSafe.omit({ provenance: true }).extend({ provenance: z.literal("rpc_observed_untrusted_near_tron_base_source_v1") });
const sourceProof = z.union([safe, rpcObservedSafe, rpcObservedNearSafe]);
const phase = z.enum(["staged_untrusted", "signing_started", "sealed", "submitting", "submitted_pending",
    "unknown_finality", "source_observed_untrusted", "source_confirmed", "source_reverted"]);
const signedHex = z.string().regex(/^0x(?:[a-f0-9]{2})*$/u).max(32_770);
const snapshot = z.strictObject({ phase, signedTransaction: signedHex.nullable(), transactionHash: wordSchema.nullable(),
    nonceAtomic: uintSchema.nullable(), submissionAttempts: z.union([z.literal(0), z.literal(1)]),
    safeSourceProof: sourceProof.nullable(), reason: z.string().max(128).nullable() });
const entry = z.strictObject({ ...snapshot.shape, at: isoSchema, previousHash: hashSchema, transitionHash: hashSchema });
const schemaV1 = z.strictObject({ schemaVersion: z.literal("apn.non-evm-source-journal.v1"),
    kind: z.literal("non_evm_source_journal"), executionAdmitted: z.literal(false),
    profileHash: hashSchema, operationId: hashSchema, draftIntegrityHash: hashSchema,
    route: pair, sourceCall: call, maxSourceNativeDebitWei: uintSchema, admissionProof: proof, createdAt: isoSchema,
    ...snapshot.shape, transitions: z.array(entry).min(1).max(32), integrityHash: hashSchema });
const schemaV2 = schemaV1.extend({ schemaVersion: z.literal("apn.non-evm-source-journal.v2"), protocolInputHash: hashSchema });
const schema = z.discriminatedUnion("schemaVersion", [schemaV1, schemaV2]);
function corrupt() { return bridgeFailure("APN_STATE_CORRUPT", "non_evm_source_journal"); }
function blocked() { return bridgeFailure("APN_OPERATION_BLOCKED", "non_evm_source_transition_blocked"); }
function snapshotOf(j) {
    return { phase: j.phase, signedTransaction: j.signedTransaction, transactionHash: j.transactionHash,
        nonceAtomic: j.nonceAtomic, submissionAttempts: j.submissionAttempts,
        safeSourceProof: j.safeSourceProof, reason: j.reason };
}
const edges = {
    staged_untrusted: ["signing_started"], signing_started: ["sealed"], sealed: ["submitting"],
    submitting: ["submitted_pending", "unknown_finality", "source_observed_untrusted", "source_confirmed", "source_reverted"],
    submitted_pending: ["unknown_finality", "source_observed_untrusted", "source_confirmed", "source_reverted"],
    unknown_finality: ["source_observed_untrusted", "source_confirmed", "source_reverted"],
    source_observed_untrusted: ["unknown_finality"],
    source_confirmed: ["unknown_finality"], source_reverted: ["unknown_finality"],
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
    const p = schema.safeParse(value);
    if (!p.success)
        corrupt();
    const j = p.data, { integrityHash, ...body } = j;
    if (hashObject(body) !== integrityHash || j.sourceCall.dataSha256 !== sha256(Buffer.from(j.sourceCall.data.slice(2), "hex")) ||
        BigInt(j.sourceCall.gasLimitAtomic) < 1n || BigInt(j.sourceCall.maxFeePerGasAtomic) < 1n ||
        BigInt(j.sourceCall.maxPriorityFeePerGasAtomic) > BigInt(j.sourceCall.maxFeePerGasAtomic) ||
        BigInt(j.sourceCall.gasLimitAtomic) * BigInt(j.sourceCall.maxFeePerGasAtomic) +
            BigInt(j.sourceCall.valueAtomic) > BigInt(j.maxSourceNativeDebitWei) ||
        (j.route === "base_usdc_to_solana_usdc_circle_cctp_v2"
            ? j.sourceCall.to !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || !j.sourceCall.data.startsWith("0xc62fa55e")
            : j.sourceCall.to !== BRIDGE_DIAMOND || !j.sourceCall.data.startsWith("0x3110c7b9")))
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
        if ((e.phase === "source_observed_untrusted" || e.phase === "source_confirmed" || e.phase === "source_reverted") !== (e.safeSourceProof !== null))
            corrupt();
        if (e.safeSourceProof !== null && (e.safeSourceProof.transactionHash !== e.transactionHash ||
            (e.phase !== "source_observed_untrusted" && e.safeSourceProof.status !== (e.phase === "source_confirmed" ? "success" : "reverted")) ||
            BigInt(e.safeSourceProof.safeBlockNumberAtomic) < BigInt(e.safeSourceProof.blockNumberAtomic)))
            corrupt();
        if (e.safeSourceProof?.provenance === "rpc_observed_untrusted_circle_v2_base_source_v1" &&
            (j.route !== "base_usdc_to_solana_usdc_circle_cctp_v2" || e.phase !== "source_observed_untrusted" ||
                (e.safeSourceProof.status === "success") !== (e.safeSourceProof.protocolProofHash !== null)))
            corrupt();
        if (e.safeSourceProof?.provenance === "rpc_observed_untrusted_near_tron_base_source_v1" &&
            (j.route !== "base_usdc_to_tron_usdt_lifi_near_intents" || e.phase !== "source_observed_untrusted" ||
                (e.safeSourceProof.status === "success") !== (e.safeSourceProof.protocolProofHash !== null)))
            corrupt();
        prior = e;
    }
    if (prior === undefined || hashObject(snapshotOf(j)) !== hashObject(snapshotOf(prior)))
        corrupt();
    return j;
}
function build(binding, version) {
    if (version === "v1" && ("schemaVersion" in binding || "protocolInputHash" in binding))
        corrupt();
    const initial = { phase: "staged_untrusted", signedTransaction: null, transactionHash: null,
        nonceAtomic: null, submissionAttempts: 0, safeSourceProof: null, reason: null };
    const first = { ...initial, at: binding.createdAt, previousHash: binding.draftIntegrityHash };
    const value = { schemaVersion: `apn.non-evm-source-journal.${version}`, kind: "non_evm_source_journal",
        executionAdmitted: false, ...binding, ...initial,
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
            nonceAtomic: j.sourceCall.nonceAtomic, transactionHash,
            ...(j.schemaVersion === "apn.non-evm-source-journal.v2" ? { protocolInputHash: j.protocolInputHash } : {}) };
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
            nonceAtomic: j.sourceCall.nonceAtomic, transactionHash: j.transactionHash,
            ...(j.schemaVersion === "apn.non-evm-source-journal.v2" ? { protocolInputHash: j.protocolInputHash } : {}) };
        if (prior === null || hashObject(prior) !== hashObject({ ...identity, integrityHash: hashObject(identity) }))
            corrupt();
    }
    /** A synthetically supplied proof is permanently untrusted. An adapter must introduce a new versioned admission contract. */
    async stage(binding) {
        return this.stageBuilt(build(binding, "v1"));
    }
    /** Stage a new record with a durable, untrusted protocol input identity. */
    async stageV2(binding) {
        if (binding.schemaVersion !== "apn.non-evm-source-journal.v2")
            corrupt();
        return this.stageBuilt(build(binding, "v2"));
    }
    async stageBuilt(j) {
        await this.initialize();
        return this.withLocks([`profile:${j.profileHash}`, `operation:${j.operationId}`], async () => {
            const prior = await this.load(j.profileHash, j.operationId);
            if (prior !== null) {
                if (prior.schemaVersion !== j.schemaVersion ||
                    (prior.schemaVersion === "apn.non-evm-source-journal.v2" && j.schemaVersion === "apn.non-evm-source-journal.v2" && prior.protocolInputHash !== j.protocolInputHash) ||
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
    /** Stores a claimed safe observation for offline state testing; neither phase nor provenance grants trust. */
    async observeSafeSource(profileHash, operationId, expectedHash, observation, at) {
        if (!safe.safeParse(observation).success)
            blocked();
        return this.change(profileHash, operationId, expectedHash, j => advance(j, { ...snapshotOf(j), phase: "source_observed_untrusted",
            safeSourceProof: observation, reason: null }, at));
    }
    /** Stores a bound RPC observation without granting its caller an authenticated provenance claim. */
    async recordRpcObservedCircleSource(profileHash, operationId, expectedHash, observation, at) {
        if (!rpcObservedSafe.safeParse(observation).success)
            blocked();
        return this.change(profileHash, operationId, expectedHash, async (j) => {
            if (j.route !== "base_usdc_to_solana_usdc_circle_cctp_v2" || j.transactionHash === null ||
                j.transactionHash !== observation.transactionHash || j.submissionAttempts !== 1)
                blocked();
            await this.assertReservation(j);
            return advance(j, { ...snapshotOf(j), phase: "source_observed_untrusted",
                safeSourceProof: observation, reason: null }, at);
        });
    }
    /** The caller and structural RPC port cannot assert authenticated source finality. */
    async recordRpcObservedNearTronSource(profileHash, operationId, expectedHash, observation, at) {
        if (!rpcObservedNearSafe.safeParse(observation).success)
            blocked();
        return this.change(profileHash, operationId, expectedHash, async (j) => {
            if (j.route !== "base_usdc_to_tron_usdt_lifi_near_intents" || j.transactionHash === null ||
                j.transactionHash !== observation.transactionHash || j.submissionAttempts !== 1)
                blocked();
            await this.assertReservation(j);
            return advance(j, { ...snapshotOf(j), phase: "source_observed_untrusted",
                safeSourceProof: observation, reason: null }, at);
        });
    }
}
//# sourceMappingURL=non-evm-source-journal.js.map