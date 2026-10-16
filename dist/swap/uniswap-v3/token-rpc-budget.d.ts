import type { RpcReadTelemetry } from "../../lifi/rpc.js";
import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenPrimaryPoolTelemetry } from "./token-rpc-pool.js";
export interface TokenRpcBudgetRow {
    readonly reservation: string;
    readonly command: string;
    readonly cap: number;
    readonly requestSessionCap?: number;
    readonly budgetClass?: "quote" | "prepare" | "approval_effect" | "swap_effect" | "recovery";
    readonly physicalRequests: number | null;
    readonly attempts: number | null;
    readonly logicalItems: number | null;
    readonly methodClasses: Readonly<Record<string, number>> | null;
    readonly batchSizes: Readonly<Record<string, number>> | null;
    readonly budgetRejects: number | null;
    readonly primaryPool?: TokenPrimaryPoolTelemetry | null;
}
interface BudgetRecord {
    readonly schemaVersion: "apn.uniswap-token-rpc-budget.v1";
    readonly binding: string;
    readonly quoteBinding: string | null;
    readonly rows: readonly TokenRpcBudgetRow[];
}
/**
 * Per-command RPC telemetry of one token operation. Each command is bounded by its own request-session cap, enforced
 * here at settle and by the transport before every request; there is no cumulative per-operation cap (SWAP-19), so a
 * command retried after a rate limit never exhausts the operation. Rows stay bounded however often commands run.
 */
export declare class UniswapTokenRpcBudgetJournal extends SecureStateStore {
    reserve(binding: string, command: string, cap: number, requestSessionCap?: number, budgetClass?: NonNullable<TokenRpcBudgetRow["budgetClass"]>): Promise<string>;
    settle(binding: string, reservation: string, telemetry: RpcReadTelemetry | null, effects: number, primaryPool?: TokenPrimaryPoolTelemetry): Promise<void>;
    linkQuote(from: string, to: string): Promise<void>;
    reconcile(binding: string): Promise<void>;
    load(binding: string): Promise<BudgetRecord | null>;
    private path;
}
export {};
