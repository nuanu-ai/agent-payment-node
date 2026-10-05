import { performance } from "node:perf_hooks";
import { ApnError } from "../errors.js";
import { HttpsBaseRpc } from "../rpc.js";
/** Concrete configured transport; no injected RPC factory, cache, retries or scalar fallback. */
export class Permit2ObserverRpc {
    rpc;
    controller = new AbortController();
    timeout;
    logicalReads = 0;
    errors = 0;
    methods = {};
    batches = 0;
    constructor(endpoint, state) {
        const deadline = performance.now() + 20_000;
        this.rpc = new HttpsBaseRpc(endpoint, { directGuardState: state,
            totalDeadlineMs: deadline, abortSignal: this.controller.signal });
        this.rpc.armEvmDirectRpcGuard();
        this.timeout = setTimeout(() => this.controller.abort(), 20_000);
    }
    async batch(calls) {
        if (calls.length < 1 || calls.length > 5 || ++this.batches > 5 || this.logicalReads + calls.length > 20 ||
            calls.some(call => !["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call",
                "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(call.method))) {
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Permit2 observer exhausted its finite read budget.");
        }
        this.logicalReads += calls.length;
        for (const call of calls)
            this.methods[call.method] = (this.methods[call.method] ?? 0) + 1;
        try {
            // The shared command deadline covers DNS and every guard/pacing/transport await.
            const signal = this.controller.signal;
            if (signal.aborted)
                aborted();
            let onAbort;
            try {
                const pipeline = (async () => {
                    await this.rpc.primePublicAddresses();
                    if (signal.aborted)
                        aborted();
                    return await this.rpc.batchCall(calls);
                })();
                // Promise.race observes late rejection too; cancellation does not cancel durable pacing I/O.
                return await Promise.race([pipeline, new Promise((_resolve, reject) => {
                        onAbort = () => reject(new ApnError("APN_RPC_AMBIGUOUS", "Permit2 observation reached its read deadline."));
                        signal.addEventListener("abort", onAbort, { once: true });
                        if (signal.aborted)
                            onAbort();
                    })]);
            }
            finally {
                if (onAbort !== undefined)
                    signal.removeEventListener("abort", onAbort);
            }
        }
        catch (error) {
            this.errors += 1;
            throw error;
        }
    }
    metrics() {
        return Object.freeze({ ...this.rpc.observationMetrics, logicalReads: this.logicalReads, errors: this.errors,
            methods: Object.freeze({ ...this.methods }) });
    }
    close() { clearTimeout(this.timeout); this.controller.abort(); }
}
function aborted() { throw new ApnError("APN_RPC_AMBIGUOUS", "Permit2 observation reached its read deadline."); }
//# sourceMappingURL=production-observer-rpc.js.map