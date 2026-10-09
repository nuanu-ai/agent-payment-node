import { BridgeHttps } from "./lifi/https.js";
import type { Cleanup85CancellationEnvelope } from "./circle-cleanup85-cancellation-contract.js";
import type { Hex } from "./model.js";
import type { CircleObservation } from "./circle-v2-evm/protocol.js";
export interface Cleanup85NativeSnapshot {
    readonly envelope: Cleanup85CancellationEnvelope;
    readonly nativeBalanceAtomic: string;
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
    private calls;
    private sequence;
    private readonly url;
    constructor(url: string, https?: Pick<BridgeHttps, "request">, maximumRequests?: number, now?: () => number);
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
    private identity;
    private block;
    snapshot(frozen?: Cleanup85CancellationEnvelope): Promise<Cleanup85NativeSnapshot>;
    private snapshotOnce;
    observation(hash: Hex): Promise<CircleObservation | null>;
    finalizedAccount(observation: CircleObservation): Promise<void>;
}
