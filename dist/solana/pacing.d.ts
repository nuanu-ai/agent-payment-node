import type { StateStore } from "../state.js";
/** Persist POST starts by provider host so separate CLI invocations respect the same public RPC allowance. */
export declare class SolanaRpcPacer {
    private readonly now;
    private readonly wait;
    private readonly scheduler;
    constructor(state: StateStore, now?: () => number, wait?: (milliseconds: number) => Promise<void>);
    schedule<T>(endpoint: string, task: () => Promise<T>): Promise<T>;
}
