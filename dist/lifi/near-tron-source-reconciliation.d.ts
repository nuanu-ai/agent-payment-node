import { type NearTronOfflineBinding } from "./near-tron-offline.js";
import type { NonEvmSourceJournal, NonEvmSourceJournalRepository } from "./non-evm-source-journal.js";
import type { BridgeRpcPort } from "./ports.js";
export interface NearTronSourceReconciliationInput {
    readonly journal: NonEvmSourceJournal;
    readonly repository: NonEvmSourceJournalRepository;
    readonly rpc: Pick<BridgeRpcPort, "chainId" | "origin" | "observe">;
    readonly frozenQuote: unknown;
    readonly binding: NearTronOfflineBinding;
    /** Independently frozen RPC endpoint; a caller-provided endpoint is never authenticated proof. */
    readonly expectedRpcOrigin: string;
    readonly observedAt: string;
}
/** A synthetic port or caller quote cannot promote this result beyond untrusted observation. */
export declare function reconcileNearTronBaseSource(input: NearTronSourceReconciliationInput): Promise<NonEvmSourceJournal>;
