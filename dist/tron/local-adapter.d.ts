import type { ChainAccount, ChainAsset, ChainAssetAlias, ChainBalance, ChainWalletStoragePort, DirectRailPort, RailEffectBinding, RailInspection, RailPreparedTransfer, RailSignedEffect } from "../direct-rail-ports.js";
import { type TronRpcPort } from "./rpc.js";
export declare class TronLocalAdapter implements DirectRailPort {
    private readonly storage;
    readonly rpc: TronRpcPort;
    private readonly now;
    readonly rail: "tron";
    readonly provider: "local";
    readonly execution: "local_signed";
    constructor(storage: ChainWalletStoragePort, rpc: TronRpcPort, now?: () => Date);
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
    inspect(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, expectedRawPayloadHash?: string): Promise<RailInspection>;
    assertValidityExpired(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string): Promise<void>;
    private requireAsset;
    private currentAccount;
}
