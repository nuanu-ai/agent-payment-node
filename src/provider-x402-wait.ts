import type { WaitPort } from "./ports.js";

export interface ProviderSettlementWaitProjection {
  readonly outcome: "completed" | "timeout" | "interrupted";
  readonly requestedSeconds: string;
  readonly observationCount: string;
}

export async function waitForProviderSettlement(
  wait: WaitPort,
  waitSeconds: number,
  deadline: number,
  observe: () => Promise<boolean>,
): Promise<ProviderSettlementWaitProjection> {
  let observations = 0;
  while (wait.nowMs() < deadline) {
    if (await observe()) return projection("completed", waitSeconds, observations + 1);
    observations += 1;
    const remaining = deadline - wait.nowMs();
    if (remaining <= 0) break;
    if (await wait.wait(Math.min(5_000, Math.max(1, Math.floor(remaining)))) === "interrupted") {
      return projection("interrupted", waitSeconds, observations);
    }
  }
  return projection("timeout", waitSeconds, observations);
}

function projection(
  outcome: ProviderSettlementWaitProjection["outcome"],
  seconds: number,
  observations: number,
): ProviderSettlementWaitProjection {
  return { outcome, requestedSeconds: seconds.toString(), observationCount: observations.toString() };
}
