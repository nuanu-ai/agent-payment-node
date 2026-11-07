import type { Address, Hex } from "../model.js";
import { type BnbCompositeCall } from "./bnb-composite.js";
export type BnbDestinationOutcome = "completed_native" | "recovered_weth" | "below_floor" | "protocol_mismatch";
export interface BnbCompositeTraceProof {
    readonly outcome: BnbDestinationOutcome;
    readonly transactionHash: Hex;
    readonly inputAmountAtomic: string;
    /** The native value Fly's router received from Core in the swap: the gross output before the signed retention. */
    readonly vaultOutputAtomic: string | null;
    readonly deliveredAmountAtomic: string;
    readonly retainedAmountAtomic: string;
    /** WETH sent back to the recipient: the fill above the Fly input, or the whole fill when the swap reverted. */
    readonly returnedWethAtomic: string;
    readonly traceHash: string;
}
/** The destination transaction (its sender, target and calldata bind the trace to it) and the fill amount its FilledRelay proved. */
export interface BnbDestinationFill {
    readonly sender: Address;
    readonly target: Address;
    readonly calldata: Hex;
    readonly amountAtomic: string;
}
/**
 * Validate the bounded callTracer tree of the Across fill into the Across/Fly composite. Proxies (the SpokePool, BSC's
 * Binance-peg WETH) run through DELEGATECALL and contracts read balances and allowances through STATICCALL; neither
 * moves value, so each frame's effects are its state-changing calls with those wrappers and reads looked through.
 * Every effect of the Receiver, the Executor and Fly's router is exact. Inside the router's call to Fly Core the route is
 * Fly's choice for the quote and is not interpreted: only its native settlement is, the net value it paid the router and
 * any it paid the Executor directly. The router's signed retention rule must turn the first into its payment to the
 * Executor, and the Executor must forward exactly what it received, after returning the WETH the swap did not take. The
 * digest covers every normalized frame, including read-only ones. A well-formed but different effect graph is a durable
 * mismatch rather than an invitation to retry the source transaction.
 */
export declare function verifyBnbCompositeTrace(raw: unknown, transactionHash: Hex, message: Hex, call: BnbCompositeCall, fill: BnbDestinationFill): BnbCompositeTraceProof;
