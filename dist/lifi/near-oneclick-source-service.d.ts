import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "./https.js";
import { type OneClickSourceRecord } from "./near-oneclick-source-journal.js";
export declare function inspectOneClickSourceQuote(response: unknown, request: Record<string, unknown>, minOutput: bigint, maxLoss: bigint, now: number): {
    deposit: `0x${string}`;
    amountIn: bigint;
    amountOut: bigint;
    minimum: bigint;
    quoteHash: string;
};
export interface OneClickSubmitRequest {
    readonly profile: string;
    readonly expectedPayer: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly minOutputAtomic: string;
    readonly maxQuotedLossAtomic: string;
    readonly maxGasLimitAtomic: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly maxNativeDebitWei: string;
    readonly idempotencyKey: string;
}
export declare class OneClickSourceService {
    private readonly state;
    private readonly wrapping;
    private readonly environment;
    private readonly https;
    private readonly now;
    private readonly approve;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, https?: BridgeHttps, now?: () => number, approve?: (record: OneClickSourceRecord) => Promise<void>);
    private journal;
    submit(input: OneClickSubmitRequest): Promise<unknown>;
    status(operationId: string): Promise<unknown>;
    private observeBase;
}
