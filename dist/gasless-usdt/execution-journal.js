import { open } from "node:fs/promises";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { validateUsdtBoundOperation } from "./bound-operation.js";
import { USDT_GASLESS } from "./model.js";
import { decodeUsdtPaymasterData, validateUsdtPaymasterData } from "./paymaster-data.js";
export const USDT_EXECUTION_SCHEMA = "apn.gasless-usdt-execution.v1";
const HASH = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const STATES = ["planned", "reserved", "failed_before_effect", "submitting", "submitted_pending", "unknown_finality", "finalized", "failed_confirmed_revert"];
function fail(reason, code = "APN_OPERATION_BLOCKED") {
    throw new ApnError(code, `Gasless USDT execution refused: ${reason}.`, { rail: "gasless_usdt", reason });
}
function identity(sender) {
    return { account: sender, chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token } };
}
function usageKey(operationId) { return `gasless-usdt-execution:${operationId}`; }
function recordBody(record) {
    const { integrityHash: _ignored, ...body } = record;
    return body;
}
function seal(body) {
    return { ...body, integrityHash: hashObject(body) };
}
function instant(now) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        fail("clock_invalid");
    return now.toISOString();
}
function expected(bound) {
    const b = bound.binding, request = b.plan.request;
    return { operationId: bound.operationId, profileHash: bound.profileHash, bindingHash: b.bindingHash,
        policyDigest: b.policyDigest, policyRevision: b.policyRevision, activationDigest: b.activationDigest,
        sender: request.sender, smartAccount: b.unsignedOperation.sender, recipient: request.recipient,
        entryPointNonce: b.account.entryPointNonce, eoaNonce: b.account.eoaNonce,
        safeBlockNumber: b.safeBlockNumber, safeBlockHash: b.safeBlockHash,
        quoteHash: hashObject({ quote: b.plan.quote, price: b.plan.price, paymasterData: b.paymasterData,
            unsignedOperation: b.unsignedOperation }),
        paymasterValidUntil: decodeUsdtPaymasterData(b.paymasterData).validUntil.toString(),
        maxFeeAtomic: request.maxFeeAtomic };
}
function exactIntent(record) {
    const { schemaVersion: _schema, reservationId: _reservation, state: _state, userOperationHash: _userOperationHash, createdAt: _created, updatedAt: _updated, integrityHash: _integrity, outcomeDigest: _outcome, settlement: _settlement, ...intent } = record;
    return intent;
}
export function validateUsdtExecutionRecord(value) {
    const keys = ["schemaVersion", "reservationId", "state", "userOperationHash", "createdAt", "updatedAt", "integrityHash",
        "operationId", "profileHash", "bindingHash", "policyDigest", "policyRevision", "activationDigest", "sender",
        "smartAccount", "recipient", "entryPointNonce", "eoaNonce", "safeBlockNumber", "safeBlockHash", "quoteHash",
        "paymasterValidUntil", "maxFeeAtomic"];
    const terminal = isPlainRecord(value) && (value.state === "finalized" || value.state === "failed_confirmed_revert");
    if (!isPlainRecord(value) || !exactKeys(value, terminal ? [...keys, "outcomeDigest", "settlement"] : keys) || value.schemaVersion !== USDT_EXECUTION_SCHEMA ||
        !STATES.includes(value.state) ||
        [value.operationId, value.profileHash, value.bindingHash, value.policyDigest, value.activationDigest,
            value.quoteHash, value.integrityHash].some(v => typeof v !== "string" || !HASH.test(v)) ||
        typeof value.reservationId !== "string" || !HASH.test(value.reservationId) ||
        (value.userOperationHash !== null && (typeof value.userOperationHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(value.userOperationHash))) ||
        ((value.state === "planned" || value.state === "reserved" || value.state === "failed_before_effect") && value.userOperationHash !== null) ||
        ((value.state === "submitting" || value.state === "submitted_pending" || value.state === "finalized" ||
            value.state === "failed_confirmed_revert") && value.userOperationHash === null) ||
        (terminal && (typeof value.outcomeDigest !== "string" || !HASH.test(value.outcomeDigest) ||
            (value.state === "finalized" ? !isPlainRecord(value.settlement) : value.settlement !== null))) ||
        !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 1 ||
        [value.entryPointNonce, value.eoaNonce, value.safeBlockNumber, value.paymasterValidUntil, value.maxFeeAtomic]
            .some(v => typeof v !== "string" || !DECIMAL.test(v)) ||
        typeof value.sender !== "string" || typeof value.smartAccount !== "string" || value.sender !== value.smartAccount ||
        typeof value.recipient !== "string" || typeof value.safeBlockHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(value.safeBlockHash) ||
        typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)) ||
        new Date(value.createdAt).toISOString() !== value.createdAt || new Date(value.updatedAt).toISOString() !== value.updatedAt ||
        Date.parse(value.updatedAt) < Date.parse(value.createdAt))
        fail("execution_record_shape", "APN_STATE_CORRUPT");
    const record = value;
    if (record.reservationId !== assetUsageReservationId(identity(record.sender), usageKey(record.operationId)) ||
        record.integrityHash !== hashObject(recordBody(record)))
        fail("execution_record_integrity", "APN_STATE_CORRUPT");
    return record;
}
/** Separate v1 effect journal. It cannot sign or send; each phase is fsynced before returning. */
export class UsdtExecutionJournal extends SecureStateStore {
    usage;
    constructor(root) { super(root); this.usage = new AssetUsageLedger(root); }
    path(operationId) {
        if (!HASH.test(operationId))
            fail("operation_id_invalid");
        return `gasless-usdt-executions/${operationId}.json`;
    }
    lock(operationId) { return `gasless-usdt-execution:${operationId}`; }
    /** OS advisory lock held from pre-submit recovery through signing and the durable may-have-sent marker. */
    async withEffectLock(operationId, action) {
        await this.initialize();
        return await this.withLocks([`gasless-usdt-effect:${operationId}`], async () => await action(async (bound, now) => await this.abortUnsentLocked(bound, now)));
    }
    async abortUnsent(bound, now) {
        return await this.withEffectLock(bound.operationId, async (abort) => await abort(bound, now));
    }
    /** Caller holds the effect lock. The terminal marker is fsynced before releasing a reserved usage lease. */
    async abortUnsentLocked(boundValue, now) {
        const bound = validateUsdtBoundOperation(boundValue);
        await this.ready();
        return await this.withLocks([this.lock(bound.operationId)], async () => {
            const current = await this.load(bound.operationId);
            if (current === null)
                return null;
            if (canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound)))
                fail("execution_binding_changed");
            if (!["planned", "reserved", "failed_before_effect"].includes(current.state))
                return null;
            const next = current.state === "failed_before_effect" ? current : seal({ ...recordBody(current),
                state: "failed_before_effect", updatedAt: instant(now) });
            if (next !== current)
                await this.write(next);
            const lease = await this.usage.load(identity(current.sender), current.reservationId);
            if (lease !== null) {
                if (lease.policyDigest !== current.policyDigest || lease.amountAtomic !== bound.binding.plan.request.grossAtomic ||
                    !["reserved", "failed_before_effect"].includes(lease.state))
                    fail("usage_reservation_mismatch", "APN_STATE_CORRUPT");
                await this.usage.transition({ ...identity(current.sender), reservationId: current.reservationId,
                    policyDigest: current.policyDigest, state: "failed_before_effect", expectedCurrentStates: ["reserved", "failed_before_effect"],
                    outcomeDigest: hashObject({ operationId: bound.operationId, bindingHash: bound.binding.bindingHash, result: "failed_before_effect" }), now });
            }
            return next;
        });
    }
    async load(operationId) {
        if (!HASH.test(operationId))
            fail("operation_id_invalid");
        const value = await this.readJson(this.path(operationId));
        if (value === null)
            return null;
        const record = validateUsdtExecutionRecord(value);
        if (record.operationId !== operationId)
            fail("execution_path_binding", "APN_STATE_CORRUPT");
        return record;
    }
    async ready() {
        await this.initialize();
        await this.ensureDirectory("gasless-usdt-executions");
        // ensureDirectory checks the new child but does not persist its name in the root.
        // Never reserve usage until that parent directory entry is durable. Repeat this
        // sync on retries after a crash between mkdir and fsync.
        try {
            await this.syncExecutionDirectoryParent();
        }
        catch {
            fail("execution_directory_sync_unavailable");
        }
    }
    async syncExecutionDirectoryParent() {
        const handle = await open(this.root, "r");
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    async write(record, createOnly = false) {
        await this.writeJson(this.path(record.operationId), record, createOnly);
    }
    async otherUsage(bound, at) {
        const b = bound.binding, account = identity(b.plan.request.sender);
        const reservationId = assetUsageReservationId(account, usageKey(bound.operationId));
        const { snapshot, reservation: own } = await this.usage.usageWithReservation(account, reservationId, at);
        if (own === null)
            return snapshot;
        if (own.state !== "reserved" || own.policyDigest !== b.policyDigest || own.rail !== "gasless" ||
            own.amountAtomic !== b.plan.request.grossAtomic)
            fail("usage_reservation_mismatch");
        const other = BigInt(snapshot.amountAtomic) - BigInt(own.amountAtomic);
        if (other < 0n)
            fail("usage_total_mismatch", "APN_STATE_CORRUPT");
        return { amountAtomic: other.toString(), windowStart: snapshot.windowStart };
    }
    async guard(bound, port) {
        validateUsdtBoundOperation(bound);
        const b = bound.binding, at = port.now();
        instant(at);
        const payload = decodeUsdtPaymasterData(b.paymasterData);
        if (BigInt(Math.floor(at.getTime() / 1000)) + 60n > payload.validUntil || payload.validAfter > BigInt(Math.floor(at.getTime() / 1000)))
            fail("paymaster_expired");
        // Reconstruct the quoted maximum from the signed payload; the fee cap remains the owner's exact bound.
        const plan = { ...b.plan, request: { ...b.plan.request, grossAtomic: BigInt(b.plan.request.grossAtomic),
                maxFeeAtomic: BigInt(b.plan.request.maxFeeAtomic), minReceivedAtomic: BigInt(b.plan.request.minReceivedAtomic) },
            quote: { ...b.plan.quote, postOpGas: BigInt(b.plan.quote.postOpGas), exchangeRate: BigInt(b.plan.quote.exchangeRate),
                exchangeRateNativeToUsd: BigInt(b.plan.quote.exchangeRateNativeToUsd) },
            price: { ...b.plan.price, maxFeePerGas: BigInt(b.plan.price.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(b.plan.price.maxPriorityFeePerGas) },
            gas: Object.fromEntries(Object.entries(b.plan.gas).map(([key, value]) => [key, BigInt(value)])),
            feeCapAtomic: BigInt(b.plan.feeCapAtomic), netAtomic: BigInt(b.plan.netAtomic), quotedFeeAtomic: BigInt(b.plan.quotedFeeAtomic) };
        validateUsdtPaymasterData({ paymaster: USDT_GASLESS.paymaster, paymasterData: b.paymasterData }, plan, BigInt(Math.floor(at.getTime() / 1000)));
        if (BigInt(b.plan.feeCapAtomic) !== BigInt(b.plan.request.maxFeeAtomic) ||
            BigInt(b.plan.quotedFeeAtomic) > BigInt(b.plan.request.maxFeeAtomic))
            fail("fee_bound_changed");
        const active = await port.activePolicy(b.profile);
        if (active === null || active.profile !== b.profile || active.digest !== active.registry.policyDigest ||
            active.digest !== b.policyDigest || active.revision !== b.policyRevision || active.activationDigest !== b.activationDigest ||
            active.accounts.evm !== b.plan.request.sender)
            fail("policy_changed");
        const snapshot = await port.safeSnapshot(b.plan.request.sender);
        if (snapshot.chainId !== 1n || snapshot.blockNumber.toString() !== b.safeBlockNumber ||
            snapshot.blockHash !== b.safeBlockHash || snapshot.account.entryPointNonce.toString() !== b.account.entryPointNonce ||
            snapshot.account.eoaNonce.toString() !== b.account.eoaNonce || snapshot.account.delegation !== b.account.delegation ||
            snapshot.account.usdtBalanceAtomic.toString() !== b.account.usdtBalanceAtomic)
            fail("safe_snapshot_changed");
        const usage = await this.otherUsage(bound, at);
        const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: identity(b.plan.request.sender).asset,
            rail: "gasless", amountAtomic: b.plan.request.grossAtomic, dailyUsageAtomic: usage.amountAtomic,
            asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
        if (admission.asset.mechanismPins?.gasless === undefined ||
            canonicalJson(admission.asset.mechanismPins.gasless) !== canonicalJson(USDT_GASLESS.mechanism))
            fail("policy_mechanism_changed");
        return { now: at, registry: active.registry };
    }
    /** Last read fence immediately before the submitting marker. Dispatch must perform its own fresh guard. */
    async submissionFence(bound, port) {
        const b = bound.binding;
        const usage = await this.otherUsage(bound, port.now());
        const active = await port.activePolicy(b.profile);
        // No awaited provider read follows this clock sample before journal publication.
        const at = port.now();
        instant(at);
        const nowSeconds = BigInt(Math.floor(at.getTime() / 1000));
        const payload = decodeUsdtPaymasterData(b.paymasterData);
        if (nowSeconds + 60n > payload.validUntil || payload.validAfter > nowSeconds)
            fail("paymaster_expired");
        if (usage.windowStart.slice(0, 10) !== at.toISOString().slice(0, 10))
            fail("usage_window_changed");
        if (active === null || active.profile !== b.profile || active.digest !== active.registry.policyDigest ||
            active.digest !== b.policyDigest || active.revision !== b.policyRevision || active.activationDigest !== b.activationDigest ||
            active.accounts.evm !== b.plan.request.sender)
            fail("policy_changed");
        const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: identity(b.plan.request.sender).asset,
            rail: "gasless", amountAtomic: b.plan.request.grossAtomic, dailyUsageAtomic: usage.amountAtomic,
            asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
        if (admission.asset.mechanismPins?.gasless === undefined ||
            canonicalJson(admission.asset.mechanismPins.gasless) !== canonicalJson(USDT_GASLESS.mechanism))
            fail("policy_mechanism_changed");
        return at;
    }
    /** Create a durable intent, then atomically reserve common usage. Retry repairs only the exact planned intent. */
    async reserve(boundValue, intent, port) {
        const bound = validateUsdtBoundOperation(boundValue), wanted = expected(bound);
        if (canonicalJson(intent) !== canonicalJson(wanted))
            fail("execution_intent_mismatch", "APN_IDEMPOTENCY_CONFLICT");
        await this.ready();
        let current = await this.withLocks([this.lock(bound.operationId)], async () => {
            const found = await this.load(bound.operationId);
            if (found !== null) {
                if (canonicalJson(exactIntent(found)) !== canonicalJson(wanted))
                    fail("execution_replay_conflict", "APN_IDEMPOTENCY_CONFLICT");
                return found;
            }
            const checked = await this.guard(bound, port);
            const body = { schemaVersion: USDT_EXECUTION_SCHEMA, ...wanted,
                reservationId: assetUsageReservationId(identity(wanted.sender), usageKey(wanted.operationId)),
                state: "planned", userOperationHash: null, createdAt: instant(checked.now), updatedAt: instant(checked.now) };
            const next = seal(body);
            await this.write(next, true);
            return next;
        });
        if (current.state !== "planned")
            return current;
        // The ledger is separately locked. A crash here leaves a planned record and a deterministic reservation to reconcile.
        const checked = await this.guard(bound, port);
        const lease = await this.usage.reserve({ ...identity(wanted.sender), registry: checked.registry, rail: "gasless",
            amountAtomic: bound.binding.plan.request.grossAtomic, idempotencyKey: usageKey(wanted.operationId), now: checked.now });
        if (lease.reservationId !== current.reservationId || lease.policyDigest !== wanted.policyDigest || lease.state !== "reserved")
            fail("usage_reservation_mismatch", "APN_STATE_CORRUPT");
        current = await this.withLocks([this.lock(bound.operationId)], async () => {
            const found = await this.load(bound.operationId);
            if (found === null || canonicalJson(exactIntent(found)) !== canonicalJson(wanted))
                fail("execution_lost", "APN_STATE_CORRUPT");
            if (found.state !== "planned")
                return found;
            const next = seal({ ...recordBody(found), state: "reserved", updatedAt: instant(checked.now) });
            await this.write(next);
            return next;
        });
        return current;
    }
    /** Persist the may-have-sent boundary. A retry cannot issue another send from this state. */
    async markSubmitting(boundValue, port, userOperationHash) {
        const bound = validateUsdtBoundOperation(boundValue);
        await this.ready();
        if (!/^0x[0-9a-f]{64}$/u.test(userOperationHash))
            fail("user_operation_hash_invalid");
        return this.withLocks([this.lock(bound.operationId)], async () => {
            const current = await this.load(bound.operationId);
            if (current === null || canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound)))
                fail("execution_binding_changed");
            if (current.state !== "reserved")
                fail("execution_already_attempted");
            await this.guard(bound, port);
            const lease = await this.usage.load(identity(current.sender), current.reservationId);
            if (lease === null || lease.state !== "reserved" || lease.policyDigest !== current.policyDigest ||
                lease.amountAtomic !== bound.binding.plan.request.grossAtomic)
                fail("usage_reservation_mismatch");
            const fenced = await this.submissionFence(bound, port);
            const next = seal({ ...recordBody(current), state: "submitting", userOperationHash, updatedAt: instant(fenced) });
            await this.write(next);
            return next;
        });
    }
    /** A matching bundler acknowledgement does not settle the transfer; observation remains required. */
    async markSubmitted(boundValue, userOperationHash, now) {
        const bound = validateUsdtBoundOperation(boundValue);
        await this.ready();
        return this.withLocks([this.lock(bound.operationId)], async () => {
            const current = await this.load(bound.operationId);
            if (current === null || canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound)) ||
                current.state !== "submitting" || current.userOperationHash !== userOperationHash)
                fail("submission_acknowledgement_mismatch");
            const next = seal({ ...recordBody(current), state: "submitted_pending", updatedAt: instant(now) });
            await this.write(next);
            return next;
        });
    }
    /** Explicit uncertainty classification only; there is no send or automatic retry path. */
    async markUnknownFinality(boundValue, now) {
        const bound = validateUsdtBoundOperation(boundValue);
        await this.ready();
        return this.withLocks([this.lock(bound.operationId)], async () => {
            const current = await this.load(bound.operationId);
            if (current === null || canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound)) ||
                !["submitting", "submitted_pending", "unknown_finality"].includes(current.state))
                fail("unknown_finality_source");
            await this.usage.transition({ ...identity(current.sender), reservationId: current.reservationId,
                policyDigest: current.policyDigest, state: "unknown_finality", expectedCurrentStates: ["reserved", "unknown_finality"], now });
            const next = seal({ ...recordBody(current), state: "unknown_finality", updatedAt: instant(now) });
            await this.write(next);
            return next;
        });
    }
    /** Replaying the same observation repairs a crash between the ledger and journal writes. */
    async recordObservedOutcome(boundValue, outcome, now) {
        const bound = validateUsdtBoundOperation(boundValue);
        await this.ready();
        if (!HASH.test(outcome.digest) || (outcome.state === "finalized") !== (outcome.settlement !== null))
            fail("observation_outcome_invalid");
        return this.withLocks([this.lock(bound.operationId)], async () => {
            const current = await this.load(bound.operationId);
            if (current === null || canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound)) ||
                current.userOperationHash === null || ["planned", "reserved"].includes(current.state))
                fail("observation_source_invalid");
            if (current.state === "finalized" || current.state === "failed_confirmed_revert") {
                if (current.state !== outcome.state || current.outcomeDigest !== outcome.digest ||
                    canonicalJson(current.settlement) !== canonicalJson(outcome.settlement))
                    fail("observation_replay_conflict", "APN_IDEMPOTENCY_CONFLICT");
                return current;
            }
            const lease = await this.usage.load(identity(current.sender), current.reservationId);
            if (lease === null || lease.policyDigest !== current.policyDigest || lease.amountAtomic !== bound.binding.plan.request.grossAtomic ||
                !["reserved", "unknown_finality", outcome.state].includes(lease.state))
                fail("usage_reservation_mismatch", "APN_STATE_CORRUPT");
            if (outcome.state === "failed_confirmed_revert" && lease.state === "reserved") {
                await this.usage.transition({ ...identity(current.sender), reservationId: current.reservationId,
                    policyDigest: current.policyDigest, state: "unknown_finality", expectedCurrentStates: ["reserved"], now });
            }
            await this.usage.transition({ ...identity(current.sender), reservationId: current.reservationId,
                policyDigest: current.policyDigest, state: outcome.state,
                expectedCurrentStates: ["reserved", "unknown_finality", outcome.state], outcomeDigest: outcome.digest, now });
            const next = seal({ ...recordBody(current), state: outcome.state, outcomeDigest: outcome.digest,
                settlement: outcome.settlement, updatedAt: instant(now) });
            await this.write(next);
            return next;
        });
    }
}
/** Build the caller's exact execution intent from an authenticated bound operation. */
export function usdtExecutionIntent(bound) { return expected(validateUsdtBoundOperation(bound)); }
//# sourceMappingURL=execution-journal.js.map