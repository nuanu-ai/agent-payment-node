import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RpcHttpFailure, RpcProviderScheduler, rpcProviderFamily, type RpcProviderPacingCoordinator } from "../lifi/rpc-scheduler.js";
import type { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";

export const RELAY_MAX_PHYSICAL_POSTS = 24;
export const RELAY_EXECUTION_WALL_MS = 90_000;
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;

/** One counter belongs to one explicit execute invocation, including every replay read and raw send. */
export class RelayRpcInvocation {
  private used = 0;
  private refusal: ApnError | null = null;
  private readonly scheduler: RpcProviderScheduler;
  constructor(private readonly state: StateStore, private readonly origin: string,
    private readonly transport: Rpc, private readonly signal?: AbortSignal,
    private readonly prepare?: () => Promise<void>) {
    const coordinator: RpcProviderPacingCoordinator = { coordinate: async <T>(family: string,
      work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
        saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
      const familyHash = sha256(`rpc-provider-family\0${family}`);
      return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(
        await state.loadRpcProviderPacing(familyHash), (value: number) => state.writeRpcProviderPacing(familyHash, value),
        await state.loadRpcProviderCooldown(familyHash), (value: number) => state.writeRpcProviderCooldown(familyHash, value)));
    } };
    this.scheduler = new RpcProviderScheduler(coordinator, Date.now, "reject", "rate_limit");
  }

  get rpc(): Rpc {
    return {
      batchCall: async calls => await this.post(() => this.transport.batchCall(calls)),
      submitRawTransaction: async raw => await this.post(() => this.transport.submitRawTransaction(raw)),
    };
  }

  assertAllowed(): void {
    if (this.refusal !== null) throw this.refusal;
    if (this.signal?.aborted) throw exhaustedWall();
  }

  private async post<T>(task: () => Promise<T>): Promise<T> {
    if (this.signal?.aborted) throw (this.refusal = exhaustedWall());
    if (this.used >= RELAY_MAX_PHYSICAL_POSTS) throw (this.refusal = new ApnError("APN_RPC_BUDGET_EXCEEDED",
      "Relay execution exhausted its 24 physical RPC POST allowance; resume the saved operation explicitly.",
      { reason: "relay_physical_post_cap", physicalPosts: this.used }));
    await this.prepare?.();
    if (this.signal?.aborted) throw (this.refusal = exhaustedWall());
    this.used++;
    const family = rpcProviderFamily(this.origin);
    if (family === "invalid-origin") throw new ApnError("APN_RPC_CONFIG", "Relay RPC origin is invalid.");
    try { return await this.scheduler.schedule(this.origin, Date.now,
      milliseconds => new Promise<void>((resolve, reject) => {
        if (this.signal?.aborted) { reject(exhaustedWall()); return; }
        const timer = setTimeout(() => { this.signal?.removeEventListener("abort", aborted); resolve(); }, milliseconds);
        const aborted = () => { clearTimeout(timer); reject(exhaustedWall()); };
        this.signal?.addEventListener("abort", aborted, { once: true });
      }), () => {}, async () => {
        if (this.signal?.aborted) throw exhaustedWall();
        try { return await task(); }
        catch (error) {
          if (error instanceof ApnError && error.details?.httpStatus === 429) {
            this.refusal = new ApnError("APN_RPC_RATE_LIMITED", "Relay RPC provider returned HTTP 429; resume the saved operation explicitly.",
              { reason: "relay_http_429" });
            throw new RpcHttpFailure("relay", 429);
          }
          throw error;
        }
      }) as T; }
    catch (error) { if (this.refusal !== null) throw this.refusal; throw error; }
  }
}

export function exhaustedWall(): ApnError {
  return new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay execution reached its 90-second wall deadline; resume the saved operation explicitly.",
    { reason: "relay_wall_deadline" });
}
