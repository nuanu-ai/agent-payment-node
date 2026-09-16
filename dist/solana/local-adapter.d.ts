import type { ChainAccount, ChainAsset, ChainAssetAlias, ChainBalance, ChainWalletStoragePort, DirectRailPort, RailEffectBinding, RailInspection, RailPreparedTransfer, RailSendBinding, RailSignedEffect } from "../direct-rail-ports.js";
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
    revalidate(account: ChainAccount, prepared: RailPreparedTransfer, send?: RailSendBinding | null): Promise<void>;
    /**
     * The send guard. It runs after the owner approved and before anything is signed: it re-acquires
     * the block reference so the reading time cannot have consumed the sending window, re-proves the
     * frozen fee, rent and funding bounds, and simulates the exact bytes with `sigVerify: false`.
     */
    bindSend(account: ChainAccount, prepared: RailPreparedTransfer): Promise<RailSendBinding>;
    sign(binding: RailEffectBinding): Promise<RailSignedEffect>;
    recoverEffect(binding: RailEffectBinding): Promise<RailSignedEffect | null>;
    submit(binding: RailEffectBinding, effect: RailSignedEffect | null): Promise<{
        readonly transactionId: string;
    }>;
    inspect(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, _expectedRawPayloadHash?: string, send?: RailSendBinding | null): Promise<RailInspection>;
    assertValidityExpired(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, send?: RailSendBinding | null): Promise<void>;
    private currentAccount;
    /**
     * Only a reference that can still be signed into has to be alive. Before the send guard runs there is no such
     * reference: nothing can be sealed without a binding, and the guard acquires a fresh window of its own. Requiring
     * the frozen one here would put the owner's reading time back inside the sending window, which is the whole bug.
     */
    private validBlock;
}
export declare function readSolanaBalance(rpc: SolanaRpcPort, account: ChainAccount, asset: ChainAsset, now: Date): Promise<ChainBalance>;
