import { hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction, recoverTransactionAddress } from "viem";
import { LEGACY_ONECLICK_LANE, oneClickLane, oneClickRecipient } from "./near-oneclick-lanes.js";
import { bridgeFailure } from "./validation.js";
const TRANSFER = parseAbi(["function transfer(address,uint256) returns (bool)"]);
function fail() { return bridgeFailure("APN_STATE_CORRUPT", "oneclick_source_record"); }
function blocked() { return bridgeFailure("APN_OPERATION_BLOCKED", "oneclick_source_transition"); }
export function oneClickRecordLane(record) {
    if (record.schemaVersion !== "apn.oneclick-source.v3") {
        if (record.lane !== undefined)
            fail();
        return oneClickLane(LEGACY_ONECLICK_LANE);
    }
    try {
        return oneClickLane(record.lane);
    }
    catch {
        return fail();
    }
}
/** The exact source effect for a lane: an ERC20 transfer to the deposit, or exactly amountIn wei to the deposit. */
export function oneClickSourceCall(lane, depositAddress, amountInAtomic) {
    const deposit = getAddress(depositAddress), amount = BigInt(amountInAtomic);
    if (lane.origin.kind === "native")
        return { to: deposit, data: "0x", value: amount.toString() };
    if (lane.origin.token === null)
        fail();
    return { to: lane.origin.token, data: encodeFunctionData({ abi: TRANSFER, functionName: "transfer", args: [deposit, amount] }), value: "0" };
}
function validate(value) {
    if (typeof value !== "object" || value === null)
        fail();
    const r = value;
    const { integrityHash, ...body } = r;
    if ((r.schemaVersion !== "apn.oneclick-source.v1" && r.schemaVersion !== "apn.oneclick-source.v2" && r.schemaVersion !== "apn.oneclick-source.v3") ||
        hashObject(body) !== integrityHash ||
        !/^[a-f0-9]{64}$/u.test(r.operationId) || !/^[a-f0-9]{64}$/u.test(r.profileHash) ||
        !/^0x[a-fA-F0-9]{64}$/u.test(r.sourceBlockHash) || !/^0x[a-fA-F0-9]{40}$/u.test(r.depositAddress) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(r.amountInAtomic) ||
        !Number.isFinite(Date.parse(r.quoteRequestDeadline)) || !Number.isFinite(Date.parse(r.quoteDeadline)) ||
        r.effectiveDeadline !== new Date(Math.min(Date.parse(r.quoteRequestDeadline), Date.parse(r.quoteDeadline))).toISOString() ||
        r.submissionAttempts > 1)
        fail();
    const d = r.destinationStatus;
    if (d !== null && (r.phase !== "source_observed" || r.sourceReceiptStatus !== "success" || typeof d !== "object" || d.status !== "finalized" ||
        d.recipient !== r.recipient || d.minimumOutputAtomic !== r.minAmountOutAtomic || !Array.isArray(d.transactions) || d.transactions.length === 0))
        fail();
    const lane = oneClickRecordLane(r), expected = oneClickSourceCall(lane, r.depositAddress, r.amountInAtomic);
    const v3 = r.schemaVersion === "apn.oneclick-source.v3";
    if (r.sourceCall.to !== expected.to || r.sourceCall.data !== expected.data ||
        (v3 ? r.sourceCall.value !== expected.value : r.sourceCall.value !== undefined))
        fail();
    if (v3) {
        try {
            oneClickRecipient(lane, r.recipient);
        }
        catch {
            fail();
        }
        if (lane.origin.kind === "native" ? r.depositCode !== "eoa" && r.depositCode !== "contract" : r.depositCode !== undefined)
            fail();
    }
    else if (r.depositCode !== undefined)
        fail();
    if (r.phase === "prepared" || r.phase === "signing_started") {
        if (r.rawTransaction !== null || r.transactionHash !== null || r.submissionAttempts !== 0)
            fail();
    }
    else {
        if (r.rawTransaction === null || r.transactionHash === null || keccak256(r.rawTransaction) !== r.transactionHash)
            fail();
        let tx;
        try {
            tx = parseTransaction(r.rawTransaction);
        }
        catch {
            fail();
        }
        if (tx.type !== "eip1559" || tx.chainId !== lane.origin.chainId || tx.to?.toLowerCase() !== r.sourceCall.to.toLowerCase() ||
            (tx.data ?? "0x") !== r.sourceCall.data || (tx.value ?? 0n) !== BigInt(expected.value) || tx.nonce?.toString() !== r.sourceCall.nonce ||
            tx.gas?.toString() !== r.sourceCall.gas || tx.maxFeePerGas?.toString() !== r.sourceCall.maxFeePerGas ||
            tx.maxPriorityFeePerGas?.toString() !== r.sourceCall.maxPriorityFeePerGas || (tx.accessList ?? []).length !== 0 ||
            tx.r === undefined || tx.s === undefined)
            fail();
        // A sealed source was never sent; a superseded one may or may not have been; every other signed phase was sent once.
        if (r.phase === "sealed" ? r.submissionAttempts !== 0 : r.phase !== "failed_proven_superseded" && r.submissionAttempts !== 1)
            fail();
    }
    if ((r.phase === "failed_proven_superseded") !== (r.finalizedNonceAtomic !== undefined) || r.finalizedNonceAtomic !== undefined &&
        (!/^(?:0|[1-9][0-9]*)$/u.test(r.finalizedNonceAtomic) || BigInt(r.finalizedNonceAtomic) <= BigInt(r.sourceCall.nonce)))
        fail();
    if ((r.phase === "source_observed") !== (r.sourceReceiptStatus !== null && r.sourceReceiptHash !== null))
        fail();
    return r;
}
/** Base keeps its original reservation path; every other origin chain is scoped by its EIP-155 chain ID. */
function nonceReservationPath(chainId, profileHash, payer, nonce) {
    stateIdentifier(profileHash, "profile hash");
    const owner = `${payer.toLowerCase()}-${BigInt(nonce).toString()}.json`;
    return chainId === 8453 ? `oneclick-source-nonces/${profileHash}/${owner}` : `oneclick-source-nonces/${profileHash}/eip155-${chainId}/${owner}`;
}
function nonceReservation(record) {
    return nonceReservationPath(oneClickRecordLane(record).origin.chainId, record.profileHash, record.payer, record.sourceCall.nonce);
}
/**
 * Where each phase may go next. The outcomes: `source_observed` (a safe source receipt, success or revert) and
 * `failed_proven_superseded` (another transaction took the source nonce at finality; this one can never land).
 */
export const ONECLICK_SOURCE_EDGES = {
    prepared: ["signing_started"], signing_started: ["sealed"], sealed: ["submitting", "failed_proven_superseded"],
    submitting: ["submitted_pending", "unknown_finality", "source_observed", "failed_proven_superseded"],
    submitted_pending: ["unknown_finality", "source_observed", "failed_proven_superseded"],
    unknown_finality: ["source_observed", "failed_proven_superseded"], source_observed: [], failed_proven_superseded: []
};
export class OneClickSourceJournal extends SecureStateStore {
    path(id) { stateIdentifier(id, "operation ID"); return `oneclick-source/${id}.json`; }
    async load(id) {
        const value = await this.readJson(this.path(id));
        if (value === null)
            return null;
        const record = validate(value);
        if (record.operationId !== id)
            fail();
        return record;
    }
    async stage(body) {
        await this.initialize();
        return this.withLocks([`oneclick:${body.operationId}`], async () => {
            const prior = await this.load(body.operationId);
            if (prior !== null)
                blocked();
            const draft = { ...body, schemaVersion: "apn.oneclick-source.v3", phase: "prepared",
                rawTransaction: null, transactionHash: null, submissionAttempts: 0, sourceReceiptStatus: null,
                sourceReceiptHash: null, destinationStatus: null, updatedAt: new Date().toISOString() };
            const record = validate({ ...draft, integrityHash: hashObject(draft) });
            await this.ensureDirectory("oneclick-source");
            await this.writeJson(this.path(body.operationId), record);
            return record;
        });
    }
    /** The operation that sealed a transaction at this payer nonce, if any. */
    async nonceHolder(lane, profileHash, payer, nonce) {
        const value = await this.readJson(nonceReservationPath(lane.origin.chainId, profileHash, payer, nonce.toString()));
        if (value === null)
            return null;
        const holder = value;
        if (typeof holder.operationId !== "string" || !/^[a-f0-9]{64}$/u.test(holder.operationId) ||
            typeof holder.transactionHash !== "string" || !/^0x[a-fA-F0-9]{64}$/u.test(holder.transactionHash))
            fail();
        return { operationId: holder.operationId, transactionHash: holder.transactionHash };
    }
    /** Stores the finalized destination proof once; later status answers come from the journal. */
    async recordDestination(id, expectedHash, proof) {
        await this.initialize();
        return this.withLocks([`oneclick:${id}`], async () => {
            const prior = await this.load(id);
            if (prior === null || prior.integrityHash !== expectedHash || prior.phase !== "source_observed" || prior.destinationStatus !== null)
                blocked();
            const { integrityHash: _old, ...body } = prior, next = { ...body, destinationStatus: proof, updatedAt: new Date().toISOString() };
            let record;
            try {
                record = validate({ ...next, integrityHash: hashObject(next) });
            }
            catch {
                return blocked();
            }
            await this.writeJson(this.path(id), record);
            return record;
        });
    }
    /**
     * `releasedReservation` names an earlier operation whose nonce reservation the caller proved dead before consent: its
     * deadline passed and the chain does not know its hash. At most one of the two signed transactions can use the nonce.
     */
    async advance(id, expectedHash, phase, changes = {}, releasedReservation) {
        await this.initialize();
        return this.withLocks([`oneclick:${id}`, `oneclick-nonces`], async () => {
            const prior = await this.load(id);
            if (prior === null || prior.integrityHash !== expectedHash)
                blocked();
            if (!ONECLICK_SOURCE_EDGES[prior.phase].includes(phase))
                blocked();
            const { integrityHash: _old, ...body } = prior;
            const next = { ...body, ...changes, phase, updatedAt: new Date().toISOString() };
            // Validate the exact sealed transaction before reserving its nonce, so a rejected seal leaves no reservation.
            let record;
            try {
                record = validate({ ...next, integrityHash: hashObject(next) });
            }
            catch {
                return blocked();
            }
            if (phase === "sealed") {
                if (changes.rawTransaction === undefined || changes.transactionHash === undefined ||
                    keccak256(changes.rawTransaction) !== changes.transactionHash)
                    blocked();
                const sender = await recoverTransactionAddress({ serializedTransaction: changes.rawTransaction });
                if (sender.toLowerCase() !== prior.payer.toLowerCase())
                    blocked();
                const reservation = nonceReservation(prior);
                const existing = await this.readJson(reservation);
                if (existing !== null && (releasedReservation === undefined || existing.operationId !== releasedReservation))
                    blocked();
                await this.ensureDirectory(reservation.slice(0, reservation.lastIndexOf("/")));
                await this.writeJson(reservation, { operationId: id, transactionHash: changes.transactionHash });
            }
            await this.writeJson(this.path(id), record);
            return record;
        });
    }
}
//# sourceMappingURL=near-oneclick-source-journal.js.map