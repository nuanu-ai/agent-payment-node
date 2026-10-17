import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { SolanaRpc } from "../../solana/rpc.js";
import type { SwapOperationRecord } from "../../swap/model.js";
import { type OrcaStableConsentPort } from "./recovery-consent.js";
/**
 * The four exits of stable USDC to USDT operations a released version (0.5.45 or earlier) prepared: read status (and
 * release an expired unsigned preparation), release an unsigned preparation, prove a marked-but-unsigned execution never
 * sent (owner TTY consent), and observe a claimed or signed execution to its finalized, reverted or expired outcome.
 */
export interface OrcaStableLegacyFinisher {
    status(operationId: string): Promise<unknown>;
    release(operationId: string): Promise<unknown>;
    recoverNoSend(operationId: string): Promise<SwapOperationRecord>;
    observe(operationId: string): Promise<SwapOperationRecord>;
}
export interface OrcaStableLegacyPorts {
    readonly root: string;
    readonly clock: ClockPort;
    /** Public account metadata for every exit; the sealed effect lookup only for no-send recovery. */
    readonly accounts: Pick<ChainWalletStoragePort, "account" | "effectByOperationId">;
    /** Budgeted, persistently paced Solana RPC: observation only. */
    readonly rpc: SolanaRpc;
    readonly consent: OrcaStableConsentPort;
}
export declare function orcaStableLegacyFinisher(ports: OrcaStableLegacyPorts): OrcaStableLegacyFinisher;
