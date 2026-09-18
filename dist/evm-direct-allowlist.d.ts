import { type DirectAllowlistSubject, type DirectUsageTarget } from "./direct-allowlist-gate.js";
import { type EvmAssetSelection } from "./evm-asset.js";
import type { OperationRecord, OperationState } from "./model.js";
export interface ListedEvmAsset {
    readonly selection: EvmAssetSelection;
    /** Decimals always come from the frozen list row, never from the caller or the token contract. */
    readonly decimals: number;
}
/**
 * Direct EVM transfers accept only frozen-list networks and pinned list contracts. This runs in the CLI/MCP binder and
 * again at prepare, before any RPC, custody or signing call.
 */
export declare function listedEvmAsset(chainValue: unknown, tokenValue: unknown, decimals?: number): ListedEvmAsset;
export declare function evmAllowlistSubject(operation: Pick<OperationRecord, "profile" | "operationId" | "walletAddress" | "chainId" | "token" | "amountAtomic" | "evm">): DirectAllowlistSubject;
/** A binding is optional so records written before the gate still validate; once present its lease is mandatory past `started`. */
export declare function validateEvmAllowlist(operation: OperationRecord): void;
/** The shared ledger follows the EVM journal: a signature alone stays reserved; a broadcast is charged until proven. */
export declare function evmUsageTarget(state: OperationState): DirectUsageTarget;
