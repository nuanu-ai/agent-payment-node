import type { SafeNextAction, X402FinalityClass, X402ProofClass, X402Reason, X402State } from "./x402-state-model.js";
export declare const STATE_SHAPE: Readonly<Record<X402State, {
    readonly finalityClass: X402FinalityClass;
    readonly terminal: boolean;
    readonly reason: X402Reason;
    readonly proofClass: X402ProofClass;
    readonly nextActions: readonly SafeNextAction[];
}>>;
export declare function legalNextState(from: X402State, to: X402State): boolean;
export declare function validateStateTuple(state: unknown, terminal: unknown, reason: unknown, proofClass: unknown): X402State;
