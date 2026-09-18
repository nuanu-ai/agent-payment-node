import type { Hex } from "../model.js";
import { type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import { type UsdtChainReceipt, type UsdtSettlement } from "./receipt.js";
import { type UsdtAuthorization, type UsdtUserOperation } from "./userop.js";
/** Structurally valid, recoverable and never the owner's: the sponsor simulates with it and the account rejects it. */
export declare const USDT_ESTIMATE_SIGNATURE: Hex;
/** Keyless public bundler and paymaster (one endpoint). `send` is called at most once per operation, ever. */
export interface UsdtSponsorPort {
    tokenQuote(): Promise<unknown>;
    gasPrice(): Promise<unknown>;
    paymasterData(op: UsdtUserOperation): Promise<unknown>;
    send(op: UsdtUserOperation): Promise<unknown>;
    /** A candidate transaction hash only; completion always needs the canonical RPC receipt. */
    receiptLocator(userOpHash: Hex): Promise<Hex | null>;
}
export interface UsdtAccountState {
    readonly usdtBalanceAtomic: bigint;
    readonly entryPointNonce: bigint;
    readonly eoaNonce: bigint;
    readonly delegation: "empty" | "expected";
}
/** Canonical chain reads only: pins, account state and the settlement receipt. */
export interface UsdtChainPort {
    /** Code hashes of token, EntryPoint, delegate and paymaster; USDT unpaused with zero transfer fee. Throws on drift. */
    verifyPins(): Promise<void>;
    account(sender: UsdtTransferRequest["sender"]): Promise<UsdtAccountState>;
    /** The canonical receipt once its block is at or below the safe head and on the canonical chain; null before that. */
    receiptAt(transactionHash: Hex): Promise<UsdtChainReceipt | null>;
}
/** The local key. Only `approveAndSend` reaches it, after the sponsor data is validated. */
export interface UsdtSignerPort {
    authorize(nonce: bigint): Promise<UsdtAuthorization>;
    signUserOperation(userOpHash: Hex): Promise<Hex>;
}
/** Durable operation journal. `markSending` must be on disk before the one send. */
export interface UsdtJournalPort {
    markSending(userOpHash: Hex): Promise<void>;
    markSent(userOpHash: Hex, bundlerResult: "accepted" | "unacknowledged"): Promise<void>;
}
/** Prepare: the exact token quote and fee plan. Reads the sponsor and pins only; no key, no signature. */
export declare function quoteUsdtGasless(ports: {
    sponsor: UsdtSponsorPort;
    chain: UsdtChainPort;
}, request: UsdtTransferRequest): Promise<UsdtTransferPlan>;
/** Economic check after the quote: the sender must hold the gross, because N + A can reach N + F. */
export declare function assertUsdtFunding(plan: UsdtTransferPlan, account: UsdtAccountState): void;
/**
 * The sponsor's signed payload for this exact operation, requested with a structural signature. On a first use the
 * authorization is a stub with the account's real nonce; the sponsor signs over the delegate, not the tuple. This is the
 * last step before any signature and is what the read-only rehearsal runs.
 */
export declare function sponsorUsdtOperation(sponsor: UsdtSponsorPort, plan: UsdtTransferPlan, account: UsdtAccountState, nowSeconds: bigint): Promise<Hex>;
export type UsdtSendOutcome = {
    readonly state: "sent";
    readonly userOpHash: Hex;
} | {
    readonly state: "send_unacknowledged";
    readonly userOpHash: Hex;
};
/**
 * After the foreground approval and the allowlist reservation: fresh account state, sponsor data, then the signatures,
 * then the durable marker, then exactly one send. A failed marker write sends nothing; a lost send response is recorded
 * as unacknowledged and is only ever observed, never retried.
 */
export declare function approveAndSendUsdtGasless(ports: {
    sponsor: UsdtSponsorPort;
    chain: UsdtChainPort;
    signer: UsdtSignerPort;
    journal: UsdtJournalPort;
}, plan: UsdtTransferPlan, nowSeconds: bigint): Promise<UsdtSendOutcome>;
export type UsdtObservation = {
    readonly state: "pending";
} | {
    readonly state: "completed";
    readonly settlement: UsdtSettlement;
};
/**
 * Status observes only: the bundler names a candidate transaction, the canonical RPC proves it at the safe head. It never
 * signs, discloses or sends, and absence proves nothing.
 */
export declare function observeUsdtGasless(ports: {
    sponsor: Pick<UsdtSponsorPort, "receiptLocator">;
    chain: UsdtChainPort;
}, plan: UsdtTransferPlan, userOpHash: Hex): Promise<UsdtObservation>;
