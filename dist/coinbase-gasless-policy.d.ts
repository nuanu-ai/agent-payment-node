import { type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import type { OperationRecord } from "./model.js";
import type { RuntimeContext } from "./runtime.js";
export declare const COINBASE_GASLESS_MECHANISM: {
    readonly provider: "coinbase-agentic-wallet";
    readonly reference: "awal@2.12.1:send_base_usdc:eip155:8453";
};
export interface CoinbaseGaslessAllowlistBinding {
    readonly schemaVersion: "apn.coinbase-gasless-allowlist.v1";
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest: string;
    readonly mechanism: typeof COINBASE_GASLESS_MECHANISM;
    readonly reservationId: string;
}
/** Caller holds the APN and allowlist profile locks for admission and first effect. */
export declare class CoinbaseGaslessPolicy {
    private readonly context;
    private readonly store;
    private readonly usage;
    constructor(context: RuntimeContext);
    private active;
    private admit;
    prepare(op: Pick<OperationRecord, "profile" | "walletAddress" | "recipient" | "amountAtomic" | "operationId">): Promise<CoinbaseGaslessAllowlistBinding>;
    assert(op: OperationRecord): Promise<ActiveAssetPolicy>;
    reserve(op: OperationRecord): Promise<void>;
    /** Journal state wins after a crash. Uncertain provider effects retain the full reservation. */
    reconcile(op: OperationRecord, recoveringStarted?: boolean): Promise<void>;
}
export declare function validateCoinbaseGaslessAllowlist(op: OperationRecord): CoinbaseGaslessAllowlistBinding;
