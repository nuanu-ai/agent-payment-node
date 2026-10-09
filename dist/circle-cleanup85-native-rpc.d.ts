import { type CircleArchiveReadPacer } from "./circle-archive-read-pacing.js";
import { BridgeHttps } from "./lifi/https.js";
import { CLEANUP85_RECIPIENT_CODE, CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH } from "./circle-cleanup85-native-codec.js";
import type { Cleanup85CancellationEnvelope } from "./circle-cleanup85-cancellation-contract.js";
import type { Hex } from "./model.js";
import type { CircleObservation } from "./circle-v2-evm/protocol.js";
export interface Cleanup85NativeSnapshot {
    readonly envelope: Cleanup85CancellationEnvelope;
    readonly nativeBalanceAtomic: string;
    readonly senderCode: "0x";
    readonly recipientCode: typeof CLEANUP85_RECIPIENT_CODE;
    readonly recipientDelegateCodeHash: typeof CLEANUP85_RECIPIENT_DELEGATE_CODE_HASH;
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly observedAt: number;
}
/** Separate finite transport: all physical requests count, including rejected responses.
 * Reads have no implicit retry; snapshot retries restart the entire anchored observation. */
export declare class Cleanup85NativeRpc {
    private readonly https;
    readonly maximumRequests: number;
    private readonly now;
    private readonly archivePacer;
    private readonly archiveInterval;
    private calls;
    private sequence;
    private readonly url;
    constructor(url: string, https?: Pick<BridgeHttps, "request">, maximumRequests?: number, now?: () => number, archiveMinimumIntervalMs?: string | undefined, archivePacer?: CircleArchiveReadPacer);
    get physicalRequestCount(): number;
    get remainingRequests(): number;
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
    private identity;
    private block;
    snapshot(frozen?: Cleanup85CancellationEnvelope): Promise<Cleanup85NativeSnapshot>;
    private snapshotOnce;
    observation(hash: Hex): Promise<CircleObservation | null>;
    finalizedConsumedAccount(observation: CircleObservation): Promise<void>;
    finalizedAccount(observation: CircleObservation): Promise<void>;
}
