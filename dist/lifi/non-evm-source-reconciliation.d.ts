import { type CircleV2BurnIntent } from "./circle-v2-source-receipt.js";
import type { NonEvmSourceJournal, NonEvmSourceJournalRepository } from "./non-evm-source-journal.js";
import type { BridgeRpcPort } from "./ports.js";
export interface CircleSourceReconciliationInput {
    readonly journal: NonEvmSourceJournal;
    readonly repository: NonEvmSourceJournalRepository;
    readonly rpc: Pick<BridgeRpcPort, "chainId" | "origin" | "observe">;
    readonly intent: CircleV2BurnIntent;
    /** Independently frozen expected RPC origin. */
    readonly expectedRpcOrigin: string;
    readonly observedAt: string;
}
/** Rechecks the supplied RPC result and persists only untrusted source evidence. Any inconsistency clears an earlier proof. */
export declare function reconcileCircleV2BaseSource(input: CircleSourceReconciliationInput): Promise<NonEvmSourceJournal>;
