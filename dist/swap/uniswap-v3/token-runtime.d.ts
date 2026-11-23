import type { CommandRequest } from "../../commands.js";
import type { UniswapTokenLaneQuoteBuilder } from "./token-builder.js";
import { type TokenCleanupFees, type UniswapTokenCommandRuntime, type UniswapTokenExecutionPorts } from "./token-execution.js";
import type { SavedUniswapTokenMaterialStore, UniswapTokenMaterial } from "./token-material.js";
import { UniswapTokenJournal } from "./token-operation.js";
import { type UniswapTokenLane } from "./token-lane.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import type { TokenRpcCall } from "./token-rpc.js";
/**
 * Execute's request plan in HTTP POSTs, counted from its code path (up to three reads per batch, one POST each, no retries).
 * An effect reads the pending nonce (1), the signing block (1), the code pins at it (4: four batches with the archive chain id
 * in the first, or the pooled archive's anchor and three), the state at it (1: allowance and balance, plus a swap's fresh
 * quote), the simulation (1) and gas estimate (1; a swap's carries the block recheck), the fees and native balance with
 * the block recheck (1); then the send (1; its slot is held before the attempt marker, so no read can take it) and the
 * first observation (at most 3: transaction, receipt, then block and safe head). A swap is 14; an approval execute
 * resumes reads the allowance first, 15. Each further candidate of a pooled primary may cost one more probe.
 */
export declare const UNISWAP_TOKEN_EXECUTE_PLAN = 15;
/** The plan's cap for a command whose first primary batch may probe each candidate of a pooled primary once. */
export declare function uniswapTokenProbedCap(plan: number, poolCandidates: number): number;
type Prepare = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.prepare" | "swap.uniswap-bnb-token.prepare";
}>;
export interface UniswapTokenRuntimePorts extends UniswapTokenExecutionPorts {
    confirm(material: UniswapTokenMaterial): Promise<void>;
}
/**
 * One lane's token-input commands over the shared journal: its quotes, prepares and operations only. A quote, a saved
 * quote or an operation of the other lane refuses (`uniswap_token_quote_binding`, `uniswap_token_lane_mismatch`) and
 * names that lane's own command, so an RPC of one chain never reads or signs for another.
 */
export declare class InstalledUniswapTokenLaneRuntime implements UniswapTokenCommandRuntime {
    private readonly lane;
    private readonly builder;
    private readonly materials;
    private readonly journal;
    private readonly ports;
    private readonly rpcBudget?;
    private readonly rpc?;
    private readonly execution;
    constructor(lane: UniswapTokenLane, builder: UniswapTokenLaneQuoteBuilder, materials: SavedUniswapTokenMaterialStore, journal: UniswapTokenJournal, ports: UniswapTokenRuntimePorts, rpcBudget?: UniswapTokenRpcBudgetJournal | undefined, rpc?: TokenRpcCall | undefined);
    inventory(): unknown;
    quote(request: Extract<CommandRequest, {
        readonly command: "swap.uniswap-token.quote" | "swap.uniswap-bnb-token.quote";
    }>): Promise<{
        readonly quoteHash: string;
    }>;
    prepare(request: Prepare): Promise<import("./token-operation.js").UniswapTokenOperation>;
    private prepareBody;
    approve(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
    execute(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
    status(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
    /** The live allowance where one may still stand on a terminal record: an expired approval cleaned without a swap, or an owner abandon. */
    residualAllowance(op: import("./token-operation.js").UniswapTokenOperation): Promise<string | null>;
    cleanup(id: string, fees?: TokenCleanupFees): Promise<import("./token-operation.js").UniswapTokenOperation>;
    private budgeted;
    /** An operation of the other lane refuses before any of its reads, naming that lane's own status command. */
    private ownLane;
    private poolCap;
    private probedCap;
}
/** The Ethereum token lane's runtime: canonical USDC and USDT through the original SwapRouter. */
export declare class InstalledUniswapTokenRuntime extends InstalledUniswapTokenLaneRuntime {
    constructor(builder: UniswapTokenLaneQuoteBuilder, materials: SavedUniswapTokenMaterialStore, journal: UniswapTokenJournal, ports: UniswapTokenRuntimePorts, rpcBudget?: UniswapTokenRpcBudgetJournal, rpc?: TokenRpcCall);
}
export {};
