import { type GaslessTransport } from "../gasless/https.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import type { CommandRequest } from "../commands.js";
import { type UsdtPreparePort } from "./policy-prepare.js";
import type { UsdtSponsorPort } from "./engine.js";
import { GaslessUsdtOperationService } from "./service.js";
type PrepareCommand = Extract<CommandRequest, {
    readonly command: "gasless.usdt.prepare";
}>;
export interface UsdtCommandPrepareOptions {
    readonly transport?: GaslessTransport;
    /** Deterministic local test ports. Production reads the active policy and safe Ethereum snapshot. */
    readonly preparePort?: UsdtPreparePort;
    readonly sponsorPort?: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData">;
    readonly rpcUrl?: string;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly pacingNow?: () => number;
}
/** One command owns exactly seven physical RPC attempts at most: two safe-chain batches and five sponsor reads. */
export declare class UsdtCommandReadBudget implements GaslessTransport {
    private readonly state;
    private readonly transport;
    private readonly now;
    private readonly wait;
    private readonly started;
    private attempts;
    private readonly scheduler;
    constructor(state: StateStore, transport: GaslessTransport, now?: () => number, wait?: (milliseconds: number) => Promise<void>);
    count(): number;
    request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<{
        readonly status: number;
        readonly body: string;
    }>;
    private guard;
}
/** No approval, signer, reservation or dispatch port enters this service. */
export declare class GaslessUsdtCommandPrepare {
    private readonly state;
    private readonly clock;
    private readonly operations;
    private readonly options;
    constructor(state: StateStore, clock: ClockPort, operations: GaslessUsdtOperationService, options?: UsdtCommandPrepareOptions);
    prepare(input: PrepareCommand): Promise<import("./bound-operation.js").UsdtBoundOperation>;
}
export {};
