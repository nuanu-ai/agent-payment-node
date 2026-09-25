import { open } from "node:fs/promises";
import { hashTypedData } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { Permit2ExecutionIntentJournal } from "./execution-intent.js";
const SCHEMA = "apn.x402-permit2.exposure-lifecycle.v1";
const HASH = /^[a-f0-9]{64}$/u;
const STATES = ["reserving", "reserved", "exposure_unknown", "submitted_pending", "settled"];
/** Durable single-attempt boundary. A persisted exposure marker forbids a second sign or send. */
export class Permit2ExposureLifecycle extends SecureStateStore {
    intents;
    constructor(root) { super(root); this.intents = new Permit2ExecutionIntentJournal(root); }
    async ready() {
        await this.initialize();
        await this.ensureDirectory("permit2-exposures");
        const handle = await open(this.root, "r");
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    path(id) { return `permit2-exposures/${id}.json`; }
    lock(id) { return `permit2-exposure:${id}`; }
    async load(operationId) {
        if (!HASH.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Invalid Permit2 operation ID.");
        await this.ready();
        const value = await this.readJson(this.path(operationId));
        if (value === null)
            return null;
        if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "reservationId", "profileHash",
            "policyDigest", "prepareHash", "challengeHash", "typedDataDigest", "eip2612Digest", "chain", "token",
            "owner", "amountAtomic", "nonce", "deadline", "state", "reference", "proofDigest", "integrityHash"]))
            corrupt();
        const { integrityHash, ...body } = value;
        if (value.schemaVersion !== SCHEMA || value.operationId !== operationId ||
            !STATES.includes(value.state) || !HASH.test(String(integrityHash)) ||
            integrityHash !== domainHash(SCHEMA, canonicalJson(body)) ||
            (value.reference !== null && (typeof value.reference !== "string" || value.reference.length < 1 || value.reference.length > 512)) ||
            (value.proofDigest !== null && !HASH.test(String(value.proofDigest))) ||
            (value.state === "settled") !== (value.proofDigest !== null))
            corrupt();
        return value;
    }
    /**
     * The caller supplies an explicitly scoped port set. It is intentionally not in production wiring.
     * The effect lock covers the whole attempt, including the external call. After any ambiguity,
     * resume only observes the same binding and never obtains another authorization.
     */
    async resume(operationId, prepared, ports, nowSeconds) {
        if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 1)
            invalid();
        await this.ready();
        return this.withLocks([this.lock(operationId)], async () => {
            const intent = await this.intents.load(operationId);
            if (intent === null || intent.capability !== "execution_blocked")
                blocked("Permit2 intent is unavailable.");
            const binding = bound(intent);
            assertPreparedBinding(prepared, binding);
            let current = await this.load(operationId);
            if (current !== null && canonicalJson(bound(current)) !== canonicalJson(binding))
                corrupt();
            if (current === null) {
                if (BigInt(binding.deadline) <= BigInt(nowSeconds))
                    blocked("Permit2 intent has expired.");
                current = seal({ schemaVersion: SCHEMA, ...binding, state: "reserving", reference: null, proofDigest: null });
                await this.writeJson(this.path(operationId), current, true);
            }
            if (current.state === "reserving") {
                // A crash after reserve but before this write retries only the same deterministic reservation.
                const reserved = await ports.reserve(binding);
                if (canonicalJson(reserved) !== canonicalJson(binding))
                    corrupt();
                current = seal({ ...body(current), state: "reserved" });
                await this.writeJson(this.path(operationId), current);
            }
            if (current.state === "reserved") {
                if (BigInt(binding.deadline) <= BigInt(nowSeconds))
                    return current;
                // This fsynced marker precedes the first possible signature or external handoff.
                current = seal({ ...body(current), state: "exposure_unknown" });
                await this.writeJson(this.path(operationId), current);
                const authorization = await ports.sign(binding, prepared);
                const acknowledgement = await ports.submit(binding, authorization);
                if (typeof acknowledgement?.reference !== "string" || !acknowledgement.reference ||
                    acknowledgement.reference.length > 512)
                    corrupt();
                current = seal({ ...body(current), state: "submitted_pending", reference: acknowledgement.reference });
                await this.writeJson(this.path(operationId), current);
            }
            return current;
        });
    }
    /** Read-only reconciliation; observation errors leave the exposure marker and reservation intact. */
    async reconcile(operationId, ports) {
        await this.ready();
        return this.withLocks([this.lock(operationId)], async () => {
            const intent = await this.intents.load(operationId);
            const current = await this.load(operationId);
            if (intent === null || current === null || canonicalJson(bound(intent)) !== canonicalJson(bound(current)))
                corrupt();
            if (current.state === "settled" || current.state === "reserving" || current.state === "reserved")
                return current;
            let observed;
            try {
                observed = await ports.observe(bound(current), current.reference);
            }
            catch {
                return current;
            }
            if (observed?.kind !== "settled")
                return current;
            if (!HASH.test(observed.proofDigest))
                corrupt();
            const next = seal({ ...body(current), state: "settled", proofDigest: observed.proofDigest });
            await this.writeJson(this.path(operationId), next);
            return next;
        });
    }
}
function bound(value) {
    return { operationId: value.operationId, reservationId: value.reservationId, profileHash: value.profileHash,
        policyDigest: value.policyDigest, prepareHash: value.prepareHash, challengeHash: value.challengeHash,
        typedDataDigest: value.typedDataDigest, eip2612Digest: value.eip2612Digest, chain: value.chain,
        token: value.token, owner: value.owner, amountAtomic: value.amountAtomic, nonce: value.nonce,
        deadline: value.deadline };
}
function assertPreparedBinding(prepared, binding) {
    let typedDigest, eipDigest;
    try {
        typedDigest = hashTypedData(prepared.plan.permit2);
        eipDigest = prepared.plan.eip2612 === null ? null :
            hashTypedData(prepared.plan.eip2612.typedData);
    }
    catch {
        return blocked("Prepared signing data is invalid.");
    }
    if (prepared.prepareHash !== binding.prepareHash || prepared.challengeHash !== binding.challengeHash ||
        prepared.policyDigest !== binding.policyDigest || prepared.payer.toLowerCase() !== binding.owner.toLowerCase() ||
        prepared.chain !== binding.chain || prepared.token.toLowerCase() !== binding.token.toLowerCase() ||
        prepared.amountAtomic !== binding.amountAtomic || prepared.plan.authorization.nonce !== binding.nonce ||
        prepared.plan.authorization.deadline !== binding.deadline || typedDigest !== binding.typedDataDigest ||
        eipDigest !== binding.eip2612Digest)
        blocked("Prepared material differs from the immutable intent.");
}
function body(value) {
    const { integrityHash: _integrityHash, ...rest } = value;
    return rest;
}
function seal(value) {
    return { ...value, integrityHash: domainHash(SCHEMA, canonicalJson(value)) };
}
function invalid() { throw new ApnError("APN_INVALID_INPUT", "Invalid Permit2 lifecycle input."); }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Permit2 exposure journal is corrupt."); }
//# sourceMappingURL=exposure-lifecycle.js.map