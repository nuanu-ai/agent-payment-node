import { type AwalProcessRunnerPort } from "../awal-process-adapter.js";
import type { ChainAccount, ChainAsset, ChainAssetAlias, ChainBalance, ChainWalletStoragePort, DirectRailPort, RailEffectBinding, RailInspection, RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
import { type SolanaRpcPort } from "./rpc.js";
/** No production implementation exists for this pinned provider guarantee. */
export interface AwalSolanaFeeContract {
    prepare(input: Parameters<DirectRailPort["prepare"]>[0]): Promise<RailPreparedTransfer>;
    revalidate(account: ChainAccount, prepared: RailPreparedTransfer): Promise<void>;
}
export declare class SolanaAwalAdapter implements DirectRailPort {
    private readonly storage;
    private readonly rpc;
    private readonly runner;
    private readonly fees?;
    private readonly now;
    readonly rail: "solana";
    readonly provider: "coinbase-awal";
    readonly execution: "provider_atomic";
    constructor(storage: ChainWalletStoragePort, rpc: SolanaRpcPort, runner?: AwalProcessRunnerPort, fees?: AwalSolanaFeeContract | undefined, now?: () => Date);
    asset(alias: ChainAssetAlias): ChainAsset;
    canonicalAddress(input: string): string;
    assertNetwork(): Promise<string>;
    account(profile: string): Promise<ChainAccount | null>;
    ensureAccount(profile: string): Promise<ChainAccount>;
    balance(account: ChainAccount, asset: ChainAsset): Promise<ChainBalance>;
    prepare(input: Parameters<DirectRailPort["prepare"]>[0]): Promise<RailPreparedTransfer>;
    revalidate(account: ChainAccount, prepared: RailPreparedTransfer): Promise<void>;
    sign(_binding: RailEffectBinding): Promise<RailSignedEffect>;
    recoverEffect(_binding: RailEffectBinding): Promise<RailSignedEffect | null>;
    submit(binding: RailEffectBinding, effect: RailSignedEffect | null): Promise<{
        readonly transactionId: string;
    }>;
    inspect(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string): Promise<RailInspection>;
    private currentAccount;
    private providerAddress;
    /** Every awal Solana call here answers JSON without secrets (address, balance, a transaction hash, and status, which also
     * names the signed-in email): the runner keeps its stdout, which is parsed once and zeroed, never logged. Authentication
     * never runs through this adapter, so no secret output can reach it. A failure is "not signed in" only on
     * awal's own word: its exact AUTH_REQUIRED answer (`address`), or, for any other exact awal failure answer (`balance`
     * answers BALANCE_FETCH_FAILED when signed out), `awal status --json` reporting `auth.authenticated: false`. The failure's
     * message text, served by awal's remote wallet window, decides nothing. Any other failure or shape stays a protocol failure.
     * `send` never asks status: a failed send keeps its own answer, since being signed out afterwards proves nothing about it. */
    private run;
    /** True only when awal 2.12.1 `status --json` answers exit 0 with `auth.authenticated` exactly false; a status that cannot
     * run or answers anything else leaves the original failure a protocol failure. */
    private signedOut;
    private feeContract;
}
export declare function awalAmount(asset: ChainAsset, amountAtomic: string): string;
