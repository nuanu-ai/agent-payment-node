import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable, MetaMaskGaslessState } from "../model.js";
/** Every state a MetaMask gasless journal may hold (its validator refuses any other). */
export declare const MM_STATES: readonly MetaMaskGaslessState[];
export declare function mmJournalIntent(value: unknown, profileHash: string): MetaMaskGaslessIntent;
export declare function mmJournalMutable(value: Record<string, unknown>, intent: MetaMaskGaslessIntent, fingerprint: string, atInput: unknown): MetaMaskGaslessMutable;
