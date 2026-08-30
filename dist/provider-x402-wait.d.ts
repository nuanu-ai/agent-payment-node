import type { WaitPort } from "./ports.js";
export interface ProviderSettlementWaitProjection {
    readonly outcome: "completed" | "timeout" | "interrupted";
    readonly requestedSeconds: string;
    readonly observationCount: string;
}
export declare function waitForProviderSettlement(wait: WaitPort, waitSeconds: number, deadline: number, observe: () => Promise<boolean>): Promise<ProviderSettlementWaitProjection>;
