import type { StateStore } from "./state.js";
/** One command's hard transport cap, with POST starts paced across processes by provider family. */
export declare class EvmDirectRpcGuard {
    private readonly state;
    private readonly limit;
    private readonly now;
    private readonly wait;
    private physical;
    private readonly scheduler;
    constructor(state: StateStore, limit?: number, now?: () => number, wait?: (milliseconds: number) => Promise<void>, remainingWaitMs?: () => number);
    get physicalRequests(): number;
    /**
     * The refusal post() would meet before any transport, read without starting a POST: this command's cap spent, or the
     * endpoint's provider family cooling down (read under the family lock, as the scheduler reads it).
     */
    assertCanPost(endpoint: string): Promise<void>;
    post<T>(endpoint: string, task: () => Promise<T>): Promise<T>;
    private budgetExceeded;
}
