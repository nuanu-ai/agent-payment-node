import { ApnError } from "../errors.js";
import type { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
export declare const RELAY_MAX_PHYSICAL_POSTS = 24;
export declare const RELAY_EXECUTION_WALL_MS = 90000;
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;
/** One counter belongs to one explicit execute invocation, including every replay read and raw send. */
export declare class RelayRpcInvocation {
    private readonly state;
    private readonly origin;
    private readonly transport;
    private readonly signal?;
    private readonly prepare?;
    private used;
    private refusal;
    private readonly scheduler;
    constructor(state: StateStore, origin: string, transport: Rpc, signal?: AbortSignal | undefined, prepare?: (() => Promise<void>) | undefined);
    get rpc(): Rpc;
    assertAllowed(): void;
    private post;
}
export declare function exhaustedWall(): ApnError;
export {};
