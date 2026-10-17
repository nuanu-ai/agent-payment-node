/** Terminal outcome of a Relay source attempt, derived from its own saved journal. Destination delivery is separate. */
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { type RelayNativeSourcePhase } from "./native-source-journal.js";
export interface RelaySourceTerminal {
    /** `source_confirmed`: the deposit reached source finality. `failed_confirmed_revert`: an effect reverted at finality.
     * `failed_before_effect`: signed bytes never sent and provably never landing (their nonce was consumed at safe depth), or
     * (native lane) an attempt closed before anything was signed. */
    readonly state: "source_confirmed" | "failed_confirmed_revert" | "failed_before_effect";
    readonly journalIntegrityHash: string;
}
type Outcome = RelaySourceTerminal["state"];
/** The native lane's outcome by its journal phase: every phase with no transition out is one (failed_before_effect: nothing signed). */
export declare function relayNativeSourceOutcome(phase: RelayNativeSourcePhase): Outcome | null;
/** A two-effect lane (approval, then deposit): a confirmed deposit, or either effect never landed or reverted. */
export declare function relayEffectsOutcome(effects: readonly {
    readonly phase: string;
}[]): Outcome | null;
/** Each lane records a finality-proven revert as `failed`; nothing is resent after it, and its usage hold is released. */
export declare function relaySourceTerminal(root: string, op: RelayUnsignedOperation): Promise<RelaySourceTerminal | null>;
export {};
