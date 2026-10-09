import { CircleExternalRpc, type CircleExternalRpcBudget } from "./external-rpc.js";
/** Exact historical completion only. Memoization never persists or bypasses physical reanchors. */
export declare class HistoricalPaidRpc extends CircleExternalRpc {
    private readonly exactEndpoint;
    private readonly historicalBudget;
    private readonly cache;
    private logical;
    private hits;
    private physical;
    constructor(exactEndpoint: string, chain: number, historicalBudget: CircleExternalRpcBudget, operationId: string);
    readEndpoint(): string;
    assertReadDeadline(): void;
    counts(): Readonly<{
        logical: number;
        hits: number;
        physical: number;
        entries: number;
    }>;
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
