import { type AssetUsageLedger } from "../asset-usage-ledger.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
/**
 * The caller proved `sourceHash` (the deposit's first and only attempt, after a confirmed approval) final and canonical on
 * Ethereum. The deposit journal records it confirmed and the exact submitted usage hold is finalized under that journal,
 * exactly as an observation-only `relay execute` would, without asking the owner to authorize an effect that already
 * happened. Anything else (another hash, an unconfirmed approval, a hold in another state or binding) changes nothing and
 * answers false, so the caller cannot claim more than the saved state supports.
 */
export declare function reconcileRelayFinalizedSource(state: StateStore, usage: Pick<AssetUsageLedger, "load" | "transition">, op: RelayUnsignedOperation, sourceHash: string): Promise<boolean>;
