import { performance } from "node:perf_hooks";
import { ApnError } from "../errors.js";
import { assertPermit2ApprovalCurrent, permit2Now } from "./production-approval-provenance.js";
import { Permit2ProductionHttps } from "./production-http.js";
import { assertSignedOrigin } from "./production-journal.js";
import { publicPermit2Production } from "./production-repository.js";
export const PERMIT2_HTTP_DEADLINE_MS = 20_000;
/**
 * Sends a saved signed bundle at most once. Under the dispatch locks it checks the current owner, then writes attempt 1,
 * the durable request marker; only the call that wrote the marker makes the one HTTPS attempt, within 20 s and under the
 * same locks, and the marker stays whatever happens. A refusal before the marker throws; after it the result is held.
 */
export async function sendPermit2Production(journal, fence, origin, clock, https = new Permit2ProductionHttps()) {
    const id = origin.approval.operationId;
    if (fence.root !== journal.root)
        blocked();
    await fence.withScope(id, "dispatch", async (scope) => {
        const owned = await fence.scopeOwner(scope, id, "dispatch");
        assertSignedOrigin(origin, owned.record, owned.lease);
        assertPermit2ApprovalCurrent(origin.approval, owned.record, permit2Now(clock));
    });
    const marked = await journal.markFirstRequest(origin, clock);
    if (!marked.first)
        return Object.freeze({ status: publicPermit2Production(marked.record), outcome: null });
    const record = marked.record, expected = { recordHash: record.integrityHash, leaseDigest: origin.leaseDigest, walletHash: origin.walletHash };
    const deadlineMs = performance.now() + PERMIT2_HTTP_DEADLINE_MS, abort = new AbortController();
    let active = true;
    const running = fence.withScope(id, "dispatch", async (scope) => {
        let phase = "pending";
        const assertCurrent = () => {
            if (!active || performance.now() >= deadlineMs)
                blocked();
            fence.assertScopeTime(scope, id, "dispatch", assertPermit2ApprovalCurrent(origin.approval, record, permit2Now(clock)));
        };
        const attempt = { record, signal: abort.signal, assertCurrent,
            owner: async () => { assertCurrent(); await fence.scopeOwner(scope, id, "dispatch", expected); assertCurrent(); },
            step: stage => {
                assertCurrent();
                if (phase !== (stage === "construct" ? "pending" : "constructed"))
                    blocked();
                phase = stage === "construct" ? "constructed" : "ended";
            } };
        assertCurrent();
        const observation = await https.submit(attempt);
        return Object.freeze({ status: publicPermit2Production(record), outcome: Object.freeze({ kind: "observed", observation }) });
    });
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => { active = false; abort.abort(); reject(error()); }, Math.max(1, deadlineMs - performance.now()));
    });
    running.catch(() => { });
    try {
        return await Promise.race([running, timeout]);
    }
    catch {
        return Object.freeze({ status: publicPermit2Production(record), outcome: Object.freeze({ kind: "held" }) });
    }
    finally {
        active = false;
        abort.abort();
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
function error() { return new ApnError("APN_OPERATION_BLOCKED", "Permit2 request owner, approval or deadline is no longer current."); }
function blocked() { throw error(); }
//# sourceMappingURL=production-send.js.map