import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable, MetaMaskGaslessState } from "../model.js";
/** Every state a MetaMask gasless journal may hold (its validator refuses any other). */
export declare const MM_STATES: readonly MetaMaskGaslessState[];
/**
 * A record an earlier release wrote keeps the provider request id itself (`requestId`); a newer one keeps only its hash
 * (`requestIdHash`), the id being sealed apart (request-reference.ts). Each shape keeps its exact key set.
 */
export declare function mmJournalIntent(value: unknown, profileHash: string): MetaMaskGaslessIntent;
export declare function mmJournalMutable(value: Record<string, unknown>, intent: MetaMaskGaslessIntent, fingerprint: string, atInput: unknown): MetaMaskGaslessMutable;
