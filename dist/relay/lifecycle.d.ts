/** Terminal outcome of a Relay source attempt, derived from its own saved journal. Destination delivery is separate. */
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
export interface RelaySourceTerminal {
    /** `source_confirmed`: the deposit reached source finality. `failed_confirmed_revert`: an effect reverted at finality.
     * `failed_before_effect`: signed bytes never sent and provably never landing (their nonce was consumed at safe depth). */
    readonly state: "source_confirmed" | "failed_confirmed_revert" | "failed_before_effect";
    readonly journalIntegrityHash: string;
}
/** Each lane records a finality-proven revert as `failed`; nothing is resent after it, and its usage hold is released. */
export declare function relaySourceTerminal(root: string, op: RelayUnsignedOperation): Promise<RelaySourceTerminal | null>;
