import { AssetUsageLedger, type AssetUsageState } from "../../asset-usage-ledger.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { UniswapTokenQuoteRequest } from "./token-builder.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import type { UniswapTokenMaterial } from "./token-material.js";
export interface TokenUsageBinding {
    readonly reservationId: string;
    readonly state: AssetUsageState;
}
type Target = Exclude<AssetUsageState, "reserved">;
export declare class UniswapTokenUsage {
    private readonly state;
    private readonly clock;
    private readonly ledger;
    constructor(state: StateStore, clock: ClockPort, ledger: AssetUsageLedger);
    admitQuote(request: UniswapTokenQuoteRequest, now: Date): Promise<string>;
    reserve(op: UniswapTokenOperation): Promise<TokenUsageBinding>;
    confirmMaterial(material: UniswapTokenMaterial): Promise<void>;
    confirmReserved(op: UniswapTokenOperation): Promise<void>;
    confirmCleanup(op: UniswapTokenOperation): Promise<void>;
    current(op: UniswapTokenOperation): Promise<TokenUsageBinding>;
    follow(op: UniswapTokenOperation, target: Target): Promise<TokenUsageBinding>;
    private active;
    private assert;
}
export {};
