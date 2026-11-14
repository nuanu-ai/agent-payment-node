import type { ClockPort } from "../../ports.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessProviderIntent, MetaMaskGaslessProfileIdentity, MetaMaskGaslessProviderObservation, MetaMaskGaslessQuote, MetaMaskGaslessUnsignedResult } from "../model.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessQuoteInput, MetaMaskGaslessUnsignedInput } from "../ports.js";
import { type HelperRequest } from "./protocol.js";
import type { MetaMaskServerRequestQuery, MetaMaskServerRequestRead } from "./server-request.js";
export interface HelperRunnerOptions {
    readonly environment: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
}
export interface MetaMaskGaslessHelperRunner {
    run(request: HelperRequest, options: HelperRunnerOptions): Promise<unknown>;
}
export interface MetaMaskGaslessProviderClientOptions {
    readonly environment?: NodeJS.ProcessEnv;
    readonly clock?: ClockPort;
    readonly runner?: MetaMaskGaslessHelperRunner;
}
export declare class MetaMaskGaslessProviderClient implements MetaMaskGaslessProviderPort {
    private readonly environment;
    private readonly clock;
    private readonly runner;
    constructor(options?: MetaMaskGaslessProviderClientOptions);
    inspect(expected: MetaMaskGaslessProfileIdentity): Promise<MetaMaskGaslessBinding>;
    quote(input: MetaMaskGaslessQuoteInput): Promise<MetaMaskGaslessQuote>;
    buildUnsigned(input: MetaMaskGaslessUnsignedInput): Promise<MetaMaskGaslessUnsignedResult>;
    submit(intent: MetaMaskGaslessProviderIntent): Promise<MetaMaskGaslessProviderObservation>;
    observe(intent: MetaMaskGaslessProviderIntent): Promise<MetaMaskGaslessProviderObservation>;
    /** A native transfer's server-wallet request by its exact id, in the same sandboxed helper (client/server-request.ts). */
    readServerRequest(query: MetaMaskServerRequestQuery): Promise<MetaMaskServerRequestRead>;
    private invoke;
}
export declare class SubprocessMetaMaskGaslessHelperRunner implements MetaMaskGaslessHelperRunner {
    run(request: HelperRequest, options: HelperRunnerOptions): Promise<unknown>;
}
