import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable } from "../model.js";
export declare function mmJournalIntent(value: unknown, profileHash: string): MetaMaskGaslessIntent;
export declare function mmJournalMutable(value: Record<string, unknown>, intent: MetaMaskGaslessIntent, fingerprint: string, atInput: unknown): MetaMaskGaslessMutable;
