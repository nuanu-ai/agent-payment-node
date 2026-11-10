import { BridgeHttps } from "../lifi/https.js";
import { CircleRpc } from "./rpc.js";
/** One shared physical POST/deadline/concurrency budget for both public chains. No signing methods, and no read is retried
 * here; an observation (CircleRpc.observation) restarts once on HTTP 429, 500, 502, 503 or 504, so it may spend its POSTs twice. */
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
/** Lean observation and configuration at the latest head (P1/P2); every request goes through the shared budget. */
export declare class CircleExternalRpc extends CircleRpc {
    private readonly budget;
    private id;
    private count;
    private readonly publicEndpoint;
    constructor(url: string, chain: number, budget: CircleExternalRpcBudget);
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
