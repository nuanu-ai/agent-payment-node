import { performance } from "node:perf_hooks";
import { ApnError } from "../errors.js";
import { HttpsBaseRpc, type ReadOnlyRpcBatchCall } from "../rpc.js";
import type { StateStore } from "../state.js";

export interface Permit2ObservationMetrics {
  readonly attempts: number; readonly admissions: number; readonly physicalDispatches: number;
  readonly logicalReads: number; readonly errors: number; readonly methods: Readonly<Record<string, number>>;
}
/** Concrete configured transport; no injected RPC factory, cache, retries or scalar fallback. */
export class Permit2ObserverRpc {
  private readonly rpc: HttpsBaseRpc;
  private readonly controller = new AbortController();
  private readonly timeout: ReturnType<typeof setTimeout>;
  private logicalReads = 0;
  private errors = 0;
  private readonly methods: Record<string, number> = {};
  private batches = 0;
  constructor(endpoint: string, state: StateStore) {
    const deadline = performance.now() + 20_000;
    this.rpc = new HttpsBaseRpc(endpoint, { directGuardState: state,
      totalDeadlineMs: deadline, abortSignal: this.controller.signal });
    this.rpc.armEvmDirectRpcGuard();
    this.timeout = setTimeout(() => this.controller.abort(), 20_000);
  }
  async batch(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    if (calls.length < 1 || calls.length > 5 || ++this.batches > 5 || this.logicalReads + calls.length > 20 ||
        calls.some(call => !["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call",
          "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(call.method))) {
      throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Permit2 observer exhausted its finite read budget.");
    }
    this.logicalReads += calls.length;
    for (const call of calls) this.methods[call.method] = (this.methods[call.method] ?? 0) + 1;
    try {
      // DNS must share the command abort deadline before any guarded POST is admitted.
      const signal = this.controller.signal;
      if (signal.aborted) aborted();
      let onAbort: (() => void) | undefined;
      try {
        await Promise.race([this.rpc.primePublicAddresses(), new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new ApnError("APN_RPC_AMBIGUOUS", "Permit2 observation reached its read deadline."));
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        })]);
      } finally { if (onAbort !== undefined) signal.removeEventListener("abort", onAbort); }
      // A timed-out lookup may finish later, but it must never continue into batch transport.
      if (signal.aborted) aborted();
      return await this.rpc.batchCall(calls);
    }
    catch (error) { this.errors += 1; throw error; }
  }
  metrics(): Permit2ObservationMetrics {
    return Object.freeze({ ...this.rpc.observationMetrics, logicalReads: this.logicalReads, errors: this.errors,
      methods: Object.freeze({ ...this.methods }) });
  }
  close(): void { clearTimeout(this.timeout); this.controller.abort(); }
}

function aborted(): never { throw new ApnError("APN_RPC_AMBIGUOUS", "Permit2 observation reached its read deadline."); }
