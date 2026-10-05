import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { Permit2ProductionRepository } from "./production-repository.js";
import { permit2ProductionOperationDigest } from "./production-signed.js";
import { Permit2ObserverRpc } from "./production-observer-rpc.js";
import { assertObserverChain, observerBlock } from "./production-observer-facts.js";
import { signingIdentityCalls, signingTokenCalls, assertSigningIdentity, assertSigningTokens, assertSigningTime } from "./production-signing-facts.js";
import { signingOwnerFence } from "./production-signing-owner.js";
/** Actual read-only observation only. Never human approval, custody permission, or transport authority. */
export class Permit2ProductionSigningFence {
    endpoint;
    clock;
    state;
    records;
    #facts = new WeakMap();
    constructor(root, endpoint, clock = () => new Date()) {
        this.endpoint = endpoint;
        this.clock = clock;
        if (typeof root !== "string" || typeof endpoint !== "string")
            invalid();
        this.state = new StateStore(root);
        this.records = new Permit2ProductionRepository(root);
    }
    now = () => {
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime()) || now.getTime() < 0)
            invalid();
        return new Date(now.getTime());
    };
    async check(operationId, mode) {
        const id = operationId, selected = mode;
        identity(id, selected);
        const rpc = new Permit2ObserverRpc(this.endpoint, this.state);
        let onAbort;
        try {
            const pipeline = (async () => {
                const context = await signingOwnerFence(this.state, this.records, id, selected, this.now);
                open(rpc.signal);
                freeze(context);
                const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["finalized", false] }]);
                assertObserverChain(first[0]);
                const block = observerBlock(first[1], "finalized");
                assertSigningTime(context.record, this.now(), block);
                assertSigningIdentity(context.record, await rpc.batch(signingIdentityCalls(context.record, block)));
                assertSigningTokens(context.record, await rpc.batch(signingTokenCalls(context.record, block)));
                const again = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: [block.tag, false] }]);
                assertObserverChain(again[0]);
                const rechecked = observerBlock(again[1], block.tag);
                if (rechecked.hash !== block.hash || rechecked.number !== block.number || rechecked.timestamp !== block.timestamp)
                    invalid();
                await signingOwnerFence(this.state, this.records, id, selected, this.now, context);
                open(rpc.signal);
                const captured = this.now();
                assertSigningTime(context.record, captured, block);
                return { context, block, captured };
            })();
            const checked = await Promise.race([pipeline, new Promise((_resolve, reject) => {
                    onAbort = () => reject(new ApnError("APN_RPC_AMBIGUOUS", "Permit2 signing fence reached its shared deadline."));
                    rpc.signal.addEventListener("abort", onAbort, { once: true });
                    if (rpc.signal.aborted)
                        onAbort();
                })]);
            open(rpc.signal);
            const { record, lease } = checked.context;
            const projection = Object.freeze({ operationId: id, mode: selected, outcome: "checked",
                operationDigest: permit2ProductionOperationDigest(record), recordHash: record.integrityHash, materialHash: record.material.materialHash,
                walletHash: sha256(canonicalJson(record.material.wallet)), requestHash: record.material.checked.requestHash,
                challengeHash: record.material.checked.challengeHash, originalLeaseDigest: record.usageReservationDigest,
                currentLeaseDigest: lease.reservationDigest, capturedAt: checked.captured.toISOString(), blockNumber: checked.block.number,
                blockHash: checked.block.hash, rpc: rpc.metrics() });
            const fact = Object.freeze({ kind: "checked-permit2-signing-observation" });
            this.#facts.set(fact, { context: checked.context, projection });
            return Object.freeze({ projection, fact });
        }
        catch {
            return Object.freeze({ projection: Object.freeze({ operationId: id, mode: selected, outcome: "hold", operationDigest: null,
                    recordHash: null, materialHash: null, walletHash: null, requestHash: null, challengeHash: null, originalLeaseDigest: null,
                    currentLeaseDigest: null, capturedAt: null, blockNumber: null, blockHash: null, rpc: rpc.metrics() }), fact: null });
        }
        finally {
            if (onAbort !== undefined)
                rpc.signal.removeEventListener("abort", onAbort);
            rpc.close();
        }
    }
    /** Single-use private provenance; owned lifecycle/lease/owner and trusted age are rechecked, never caller facts. */
    async consume(fact, operationId, mode) {
        const id = operationId, selected = mode;
        identity(id, selected);
        const saved = this.#facts.get(fact);
        if (saved === undefined || saved.projection.operationId !== id || saved.projection.mode !== selected)
            invalid();
        const assertAge = () => {
            const now = this.now(), at = Date.parse(saved.projection.capturedAt);
            if (now.getTime() < at || now.getTime() - at > 5_000)
                invalid();
            assertSigningTime(saved.context.record, now);
        };
        assertAge();
        await signingOwnerFence(this.state, this.records, id, selected, this.now, saved.context);
        assertAge();
        if (this.#facts.get(fact) !== saved)
            invalid();
        this.#facts.delete(fact);
        return saved.projection;
    }
}
function identity(id, mode) { if (typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id) || !["reserved", "exposed"].includes(mode))
    invalid(); }
function open(signal) { if (signal.aborted)
    invalid(); }
function freeze(value) { if (value !== null && typeof value === "object") {
    for (const child of Object.values(value))
        freeze(child);
    Object.freeze(value);
} }
function invalid() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 signing fact is not current or bound to the owned operation."); }
//# sourceMappingURL=production-signing-fence.js.map