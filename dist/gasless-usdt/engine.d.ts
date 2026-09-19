import type { Hex } from "../model.js";
import { type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import { type UsdtChainReceipt, type UsdtSettlement } from "./receipt.js";
import { type UsdtUserOperation } from "./userop.js";
/** Read-only sponsor surface. There is deliberately no signing or submission method. */
export interface UsdtSponsorPort {
    tokenQuote(): Promise<unknown>;
    gasPrice(): Promise<unknown>;
    paymasterData(op: UsdtUserOperation): Promise<unknown>;
    receiptLocator(userOpHash: Hex): Promise<Hex | null>;
}
export interface UsdtAccountState {
    readonly usdtBalanceAtomic: bigint;
    readonly entryPointNonce: bigint;
    readonly eoaNonce: bigint;
    readonly delegation: "empty" | "expected";
}
/** Canonical chain reads only: pins, account state and settlement receipt. */
export interface UsdtChainPort {
    verifyPins(): Promise<void>;
    account(sender: UsdtTransferRequest["sender"]): Promise<UsdtAccountState>;
    receiptAt(transactionHash: Hex): Promise<UsdtChainReceipt | null>;
}
export declare function quoteUsdtGasless(ports: {
    sponsor: UsdtSponsorPort;
    chain: UsdtChainPort;
}, request: UsdtTransferRequest): Promise<UsdtTransferPlan>;
export declare function assertUsdtFunding(plan: UsdtTransferPlan, account: UsdtAccountState): void;
/** Requests and validates sponsor data against the exact unsigned operation. No key or effect is reachable here. */
export declare function sponsorUsdtOperation(sponsor: UsdtSponsorPort, plan: UsdtTransferPlan, account: UsdtAccountState, nowSeconds: bigint): Promise<Hex>;
export type UsdtObservation = {
    readonly state: "pending";
} | {
    readonly state: "completed";
    readonly settlement: UsdtSettlement;
};
export declare function observeUsdtGasless(ports: {
    sponsor: Pick<UsdtSponsorPort, "receiptLocator">;
    chain: UsdtChainPort;
}, plan: UsdtTransferPlan, userOpHash: Hex): Promise<UsdtObservation>;
