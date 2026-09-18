import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { assertOneClickNativePostApproval, type OneClickSourcePlan } from "./near-oneclick-evm-source.js";
import { type OneClickLane } from "./near-oneclick-lanes.js";
import { type OneClickSourceRecord } from "./near-oneclick-source-journal.js";
export { assertOneClickPostApproval } from "./near-oneclick-evm-source.js";
/** Existing v1 records hashed the whole quote envelope, including an ephemeral correlationId.
 * Rebind their provider status to every field that can change the source or destination effect.
 */
export declare function legacyStatusQuoteMatchesRecord(value: unknown, record: OneClickSourceRecord): boolean;
export declare function oneClickStatusQuoteMatchesRecord(value: unknown, record: OneClickSourceRecord): boolean;
export { assertOneClickNativePostApproval };
export declare function inspectOneClickSourceQuote(response: unknown, request: Record<string, unknown>, minOutput: bigint, maxLoss: bigint, now: number, lane: OneClickLane): {
    deposit: `0x${string}`;
    amountIn: bigint;
    amountOut: bigint;
    minimum: bigint;
    quoteHash: string;
    quoteDeadline: string;
    effectiveDeadline: string;
};
/** Legacy lane IDs keep their original derivation, so an old idempotency key still resolves to its existing operation. */
export declare function oneClickOperationId(lane: OneClickLane, profileHash: string, idempotencyKey: string): string;
export interface OneClickSubmitRequest {
    readonly lane: string;
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
    private rpcUrl;
    submit(input: OneClickSubmitRequest): Promise<unknown>;
    status(operationId: string): Promise<unknown>;
}
/** Foreground-only consent with a six-character code bound to the exact staged record. */
export declare class TtyOneClickSourceApproval {
    approve(record: OneClickSourceRecord, plan: OneClickSourcePlan): Promise<void>;
}
