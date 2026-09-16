import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { type OneClickSourceRecord } from "./near-oneclick-source-journal.js";
/** Existing v1 records hashed the whole quote envelope, including an ephemeral correlationId.
 * Rebind their provider status to every field that can change the source or destination effect.
 */
export declare function legacyStatusQuoteMatchesRecord(value: unknown, record: OneClickSourceRecord): boolean;
export declare function oneClickStatusQuoteMatchesRecord(value: unknown, record: OneClickSourceRecord): boolean;
export declare function assertOneClickPostApproval(initial: Readonly<{
    nonce: bigint;
    gas: bigint;
    fee: bigint;
    tip: bigint;
}>, fresh: Readonly<{
    nonce: bigint;
    gas: bigint;
    fee: bigint;
    tip: bigint;
    nativeDebit: bigint;
}>, maxNativeDebit: bigint, effectiveDeadlineMs: number, nowMs: number): void;
export declare function inspectOneClickSourceQuote(response: unknown, request: Record<string, unknown>, minOutput: bigint, maxLoss: bigint, now: number): {
    deposit: `0x${string}`;
    amountIn: bigint;
    amountOut: bigint;
    minimum: bigint;
    quoteHash: string;
    quoteDeadline: string;
    effectiveDeadline: string;
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
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>);
    private journal;
    submit(input: OneClickSubmitRequest): Promise<unknown>;
    status(operationId: string): Promise<unknown>;
    private observeBase;
}
export declare class TtyOneClickSourceApproval {
    approve(record: OneClickSourceRecord): Promise<void>;
}
