import type { CommandOutcome, CommandRequest } from "../commands.js";
import type { RuntimeContext } from "../runtime.js";
import type { UniswapTokenOperation } from "./uniswap-v3/token-operation.js";
type Request = Extract<CommandRequest, {
    readonly command: `swap.uniswap.${string}` | `swap.uniswap-token.${string}`;
}>;
export declare function executeUniswapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome>;
/**
 * The token lane's observed receipt already holds what the swap proved; `actualEconomics` gives it the shared swap shape:
 * the exact input debit, the output credit, every gas the operation paid (approval, swap, cleanup) and the ETH that left.
 */
export declare function tokenOutcome(value: Awaited<ReturnType<NonNullable<RuntimeContext["uniswapTokenRuntime"]>["status"]>>, residual?: string | null, after?: "execute"): CommandOutcome;
/**
 * A swap that requires cleanup names its one exit, the owner's consented cleanup; when the fee cap refused it before
 * signing, the same cleanup may instead re-quote its own caps under fresh consent. An owner-abandoned swap still holding a
 * principal no proof released names execute, which opens custody to prove its swap never signed; execute itself, having
 * found signed bytes and changed nothing, does not name itself again. A cleaned swap still holding a principal that the
 * finalized chain can release (its swap nonces held by a final cleanup, or unused past the deadline) names status, which
 * reads that proof once finality reaches it.
 */
export declare function uniswapTokenNextActions(op: UniswapTokenOperation, after?: "execute"): readonly string[];
export {};
