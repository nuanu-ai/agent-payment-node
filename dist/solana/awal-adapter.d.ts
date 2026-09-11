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
    private run;
    private feeContract;
}
export declare function awalAmount(asset: ChainAsset, amountAtomic: string): string;
