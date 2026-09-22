import type { RpcReadTelemetry } from "../../lifi/rpc.js";
import { SecureStateStore } from "../../secure-state-store.js";
export interface TokenRpcBudgetRow {
    readonly reservation: string;
    readonly command: string;
    readonly cap: number;
    readonly physicalRequests: number | null;
    readonly attempts: number | null;
    readonly logicalItems: number | null;
    readonly methodClasses: Readonly<Record<string, number>> | null;
    readonly batchSizes: Readonly<Record<string, number>> | null;
    readonly budgetRejects: number | null;
}
interface BudgetRecord {
    readonly schemaVersion: "apn.uniswap-token-rpc-budget.v1";
    readonly binding: string;
    readonly rows: readonly TokenRpcBudgetRow[];
}
export declare const TOKEN_OPERATION_RPC_CAP = 64;
export declare class UniswapTokenRpcBudgetJournal extends SecureStateStore {
    reserve(binding: string, command: string, cap: number): Promise<string>;
    settle(binding: string, reservation: string, telemetry: RpcReadTelemetry | null, effects: number): Promise<void>;
    inherit(from: string, to: string): Promise<void>;
    load(binding: string): Promise<BudgetRecord | null>;
    private path;
}
export {};
