import { BridgeHttps } from "../lifi/https.js";
import { CircleRpc } from "./rpc.js";
/** One shared physical POST/deadline/concurrency budget for both public chains. No signing methods or retries. */
export declare class CircleExternalRpcBudget {
    private readonly now;
    private readonly endsAt;
    readonly transport: Pick<BridgeHttps, "request">;
    private requests;
    private inFlight;
    private waiters;
    readonly evidence: {
        readonly chain: number;
        readonly method: string;
        readonly params: readonly unknown[];
        readonly result: unknown;
    }[];
    constructor(now: () => number, endsAt: number, transport: Pick<BridgeHttps, "request">);
    assert(): void;
    post(endpoint: string, chain: number, id: number, method: string, params: readonly unknown[]): Promise<unknown>;
}
export declare class CircleExternalRpc extends CircleRpc {
    private readonly budget;
    private id;
    private count;
    private readonly publicEndpoint;
    constructor(url: string, chain: number, budget: CircleExternalRpcBudget);
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
