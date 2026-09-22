import { ApnError } from "../errors.js";

const RPC_ORIGIN_GAP_MS = 750;
export const RPC_RETRY_DELAY_MS = 2_000;

export class RpcHttpFailure extends Error {
  constructor(readonly method: string, readonly status: number, readonly retryAfterMs?: number) { super(`RPC HTTP ${status}`); }
}

interface ScheduledRpcRead {
  readonly family: string;
  readonly now: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly beforeWait: (milliseconds: number) => void;
  readonly task: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}
export interface RpcProviderPacingCoordinator {
  coordinate<T>(family: string, work: (lastStart: number | null, saveStart: (value: number) => Promise<void>,
    cooldownUntil: number | null, saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>): Promise<T>;
}

/** Provider-family coordination. A coordinator can serialize starts and retain pacing across CLI processes. */
export class RpcProviderScheduler {
  private readonly families = new Map<string, { active: boolean; lastStart: number; cooldownUntil: number }>();
  private readonly queue: ScheduledRpcRead[] = [];
  private active = 0;
  constructor(private readonly coordinator?: RpcProviderPacingCoordinator, private readonly pacingNow?: () => number,
    private readonly cooldownMode: "wait" | "reject" = "wait",
    private readonly cooldownFailures: "rate_limit" | "transient" = "rate_limit") {}

  schedule(origin: string, now: () => number, wait: (milliseconds: number) => Promise<void>, beforeWait: (milliseconds: number) => void,
    task: () => Promise<unknown>): Promise<unknown> {
    const family = rpcProviderFamily(origin);
    return new Promise((resolve, reject) => { this.queue.push({ family, now, wait, beforeWait, task, resolve, reject }); this.pump(); });
  }

  private pump(): void {
    while (this.active < 2) {
      const index = this.queue.findIndex((entry) => !(this.families.get(entry.family)?.active ?? false));
      if (index < 0) return;
      const entry = this.queue.splice(index, 1)[0]!, state = this.families.get(entry.family) ?? {
        active: false, lastStart: Number.NEGATIVE_INFINITY, cooldownUntil: Number.NEGATIVE_INFINITY,
      };
      state.active = true; this.families.set(entry.family, state); this.active += 1; void this.run(entry, state);
    }
  }

  private async run(entry: ScheduledRpcRead, state: { active: boolean; lastStart: number; cooldownUntil: number }): Promise<void> {
    try {
      const execute = async (persisted: number | null, saveStart: (value: number) => Promise<void>, persistedCooldown: number | null,
        saveCooldownUntil: (value: number) => Promise<void>) => {
        const clock = this.coordinator === undefined ? entry.now : this.pacingNow ?? Date.now;
        const lastStart = Math.max(state.lastStart, persisted ?? Number.NEGATIVE_INFINITY);
        const cooldownUntil = Math.max(state.cooldownUntil, persistedCooldown ?? Number.NEGATIVE_INFINITY), before = clock();
        if (before < lastStart) throw new ApnError("APN_RPC_CONFIG", "RPC scheduler clock moved backwards.", {
          reason: "rpc_scheduler_clock_rollback", providerFamily: entry.family,
        });
        if (this.cooldownMode === "reject" && cooldownUntil > before) {
          throw new ApnError("APN_PROVIDER_UNAVAILABLE", "RPC provider is cooling down.", { reason: "rpc_provider_cooldown" });
        }
        const nextAllowed = Math.max(lastStart + RPC_ORIGIN_GAP_MS, cooldownUntil), delay = Math.max(0, nextAllowed - before);
        entry.beforeWait(delay); if (delay > 0) await entry.wait(delay);
        let current = clock();
        if (current < before) throw schedulerClockRollback(entry.family);
        // Timers may wake a millisecond early. A persisted coordinator must still reach the exact wall-clock boundary;
        // a clock that moves backwards or does not advance fails closed before transport.
        if ((persisted !== null || persistedCooldown !== null) && current < nextAllowed) {
          const remaining = nextAllowed - current; entry.beforeWait(remaining); await entry.wait(remaining);
          const rechecked = clock();
          if (rechecked <= current || rechecked < nextAllowed) throw schedulerClockRollback(entry.family);
          current = rechecked;
        }
        state.lastStart = current;
        await saveStart(state.lastStart);
        try { return await entry.task(); }
        catch (error) {
          const transportCooldown = this.cooldownFailures === "transient" && transientTransport(error), httpCooldown = error instanceof RpcHttpFailure &&
            (error.status === 429 || this.cooldownFailures === "transient" && error.status >= 500 && error.status <= 599);
          if (httpCooldown || transportCooldown) {
            const observed = clock();
            if (observed < current) throw schedulerClockRollback(entry.family);
            const effectiveCooldown = error instanceof RpcHttpFailure && error.status === 429
              ? Math.min(30_000, Math.max(RPC_RETRY_DELAY_MS, error.retryAfterMs ?? 0)) : 5_000;
            state.cooldownUntil = Math.max(state.cooldownUntil, observed + effectiveCooldown);
            await saveCooldownUntil(state.cooldownUntil);
          }
          throw error;
        }
      };
      entry.resolve(this.coordinator === undefined ? await execute(null, async () => {}, null, async () => {}) :
        await this.coordinator.coordinate(entry.family, execute));
    } catch (error) { entry.reject(error); }
    finally { state.active = false; this.active -= 1; this.pump(); }
  }
}

function transientTransport(error: unknown): boolean {
  if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS") return false;
  const reason = error.details?.transportReason;
  return typeof reason === "string" && ["DNS_deadline", "request_deadline", "request_interrupted", "response_aborted", "response_interrupted"]
    .includes(reason);
}

export function rpcOriginIdentity(origin: string): string { try { return new URL(origin).origin; } catch { return "invalid-origin"; } }
export function rpcProviderFamily(origin: string): string {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === "publicnode.com" || hostname.endsWith(".publicnode.com")) return "publicnode.com";
    const drpcSuffix = ".drpc.org", drpcLabel = hostname.endsWith(drpcSuffix) ? hostname.slice(0, -drpcSuffix.length) : "";
    return hostname === "drpc.org" || drpcLabel !== "" && !drpcLabel.includes(".") ? "drpc.org" : hostname;
  } catch { return "invalid-origin"; }
}

function schedulerClockRollback(providerFamily: string): ApnError {
  return new ApnError("APN_RPC_CONFIG", "RPC scheduler clock moved backwards.", {
    reason: "rpc_scheduler_clock_rollback", providerFamily,
  });
}
