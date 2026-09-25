import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RpcHttpFailure, RpcProviderScheduler, type RpcProviderPacingCoordinator } from "../lifi/rpc-scheduler.js";
import type { StateStore } from "../state.js";

/** Persist POST starts by provider host so separate CLI invocations respect the same public RPC allowance. */
export class SolanaRpcPacer {
  private readonly scheduler: RpcProviderScheduler;
  constructor(state: StateStore, private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<void> = milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds))) {
    const coordinator: RpcProviderPacingCoordinator = { coordinate: async <T>(family: string,
      work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
        saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
      const familyHash = sha256(`rpc-provider-family\0${family}`);
      return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(
        await state.loadRpcProviderPacing(familyHash), (value: number) => state.writeRpcProviderPacing(familyHash, value),
        await state.loadRpcProviderCooldown(familyHash), (value: number) => state.writeRpcProviderCooldown(familyHash, value)));
    } };
    this.scheduler = new RpcProviderScheduler(coordinator, now, "reject", "rate_limit");
  }

  async schedule<T>(endpoint: string, task: () => Promise<T>): Promise<T> {
    let rateLimit: ApnError | null = null;
    try {
      return await this.scheduler.schedule(endpoint, this.now, this.wait, () => {}, async () => {
        try { return await task(); }
        catch (error) {
          if (error instanceof ApnError && error.code === "APN_RPC_RATE_LIMITED") {
            rateLimit = error;
            throw new RpcHttpFailure("solana", 429, error.details?.retryAfterMs as number | undefined);
          }
          throw error;
        }
      }) as T;
    } catch (error) {
      if (error instanceof RpcHttpFailure && rateLimit !== null) throw rateLimit;
      throw error;
    }
  }
}
