/** Terminal outcome of a Relay source attempt, derived from its own saved journal. Destination delivery is separate. */
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { RelayEffectJournalRepository } from "./effect-journal.js";
import { RelayNativeSourceJournalRepository, type RelayNativeSourcePhase } from "./native-source-journal.js";

export interface RelaySourceTerminal {
  /** `source_confirmed`: the deposit reached source finality. `failed_confirmed_revert`: an effect reverted at finality.
   * `failed_before_effect`: signed bytes never sent and provably never landing (their nonce was consumed at safe depth), or
   * (native lane) an attempt closed before anything was signed. */
  readonly state: "source_confirmed" | "failed_confirmed_revert" | "failed_before_effect";
  readonly journalIntegrityHash: string;
}

type Outcome = RelaySourceTerminal["state"];
const NATIVE_OUTCOMES: Readonly<Partial<Record<RelayNativeSourcePhase, Outcome>>> = { confirmed: "source_confirmed",
  failed: "failed_confirmed_revert", failed_before_effect: "failed_before_effect", abandoned_unsent: "failed_before_effect" };
/** The native lane's outcome by its journal phase: every phase with no transition out is one (failed_before_effect: nothing signed). */
export function relayNativeSourceOutcome(phase: RelayNativeSourcePhase): Outcome | null { return NATIVE_OUTCOMES[phase] ?? null; }
/** A two-effect lane (approval, then deposit): a confirmed deposit, or either effect never landed or reverted. */
export function relayEffectsOutcome(effects: readonly { readonly phase: string }[]): Outcome | null {
  if (effects[1]?.phase === "confirmed") return "source_confirmed";
  if (effects.some(effect => effect.phase === "abandoned_unsent")) return "failed_before_effect";
  return effects.some(effect => effect.phase === "failed") ? "failed_confirmed_revert" : null;
}

/** Each lane records a finality-proven revert as `failed`; nothing is resent after it, and its usage hold is released. */
export async function relaySourceTerminal(root: string, op: RelayUnsignedOperation): Promise<RelaySourceTerminal | null> {
  const journal = op.arbitrumDraft !== undefined ? await new ArbitrumSourceEffectJournalRepository(root).load(op.profileHash, op.operationId)
    : op.nativeQuote !== undefined ? await new RelayNativeSourceJournalRepository(root).load(op)
      : await new RelayEffectJournalRepository(root).load(op.profileHash, op.operationId);
  if (journal === null) return null;
  const state = "effects" in journal ? relayEffectsOutcome(journal.effects) : relayNativeSourceOutcome(journal.phase);
  return state === null ? null : { state, journalIntegrityHash: journal.integrityHash };
}
