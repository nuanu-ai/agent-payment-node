import type { StateStore } from "./state.js";
/** One command's hard transport cap, with POST starts paced across processes by provider family. */
export declare class EvmDirectRpcGuard {
    private readonly limit;
    private readonly now;
    private readonly wait;
    private physical;
    private readonly scheduler;
    constructor(state: StateStore, limit?: number, now?: () => number, wait?: (milliseconds: number) => Promise<void>);
    get physicalRequests(): number;
    post<T>(endpoint: string, task: () => Promise<T>): Promise<T>;
}
