import type { ChainAccount, ChainAsset, ChainAssetAlias, ChainBalance, ChainWalletStoragePort, DirectRailPort, RailEffectBinding, RailInspection, RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
import { type SolanaRpcPort } from "./rpc.js";
export declare class SolanaLocalAdapter implements DirectRailPort {
    private readonly storage;
    readonly rpc: SolanaRpcPort;
    private readonly now;
    readonly rail: "solana";
    readonly provider: "local";
    readonly execution: "local_signed";
    constructor(storage: ChainWalletStoragePort, rpc: SolanaRpcPort, now?: () => Date);
    asset(alias: ChainAssetAlias): ChainAsset;
    canonicalAddress(input: string): string;
    assertNetwork(): Promise<string>;
    account(profile: string): Promise<ChainAccount | null>;
    ensureAccount(profile: string): Promise<ChainAccount>;
    balance(account: ChainAccount, asset: ChainAsset): Promise<ChainBalance>;
    prepare(input: {
        readonly account: ChainAccount;
        readonly asset: ChainAsset;
        readonly recipient: string;
        readonly amountAtomic: string;
        readonly maximumFeeAtomic: string;
        readonly now: Date;
    }): Promise<RailPreparedTransfer>;
    revalidate(account: ChainAccount, prepared: RailPreparedTransfer): Promise<void>;
    sign(binding: RailEffectBinding): Promise<RailSignedEffect>;
    recoverEffect(binding: RailEffectBinding): Promise<RailSignedEffect | null>;
    submit(binding: RailEffectBinding, effect: RailSignedEffect | null): Promise<{
        readonly transactionId: string;
    }>;
    inspect(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string): Promise<RailInspection>;
    private currentAccount;
    private validBlock;
}
export declare function readSolanaBalance(rpc: SolanaRpcPort, account: ChainAccount, asset: ChainAsset, now: Date): Promise<ChainBalance>;
