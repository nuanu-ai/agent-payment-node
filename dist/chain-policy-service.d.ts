import { type ChainPolicy } from "./chain-policy.js";
import { ChainPolicyStore } from "./chain-policy-store.js";
import type { ChainAccount, ChainAssetAlias, ChainProvider, DirectRailName, DirectRailPort } from "./direct-rail-ports.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import type { RuntimeContext } from "./runtime.js";
export declare class ChainPolicyService {
    private readonly context;
    readonly policies: ChainPolicyStore;
    readonly records: RailOperationRepository;
    private readonly operations;
    constructor(context: RuntimeContext);
    adapter(rail: DirectRailName, provider: ChainProvider): DirectRailPort;
    assertProfileOwner(profile: string, provider: ChainProvider): Promise<void>;
    account(profileInput: string, rail: DirectRailName): Promise<ChainAccount>;
    ensure(profileInput: string, rail: DirectRailName, provider: ChainProvider, acceptRisk: boolean): Promise<ChainAccount>;
    balance(profile: string, rail: DirectRailName, alias: ChainAssetAlias): Promise<unknown>;
    admit(input: {
        readonly profile: string;
        readonly rail: DirectRailName;
        readonly asset: ChainAssetAlias;
        readonly maximumPerTransfer: string;
        readonly dailyLimit: string;
        readonly maximumFee: string;
    }): Promise<unknown>;
    requiredPolicy(account: ChainAccount, alias: ChainAssetAlias): Promise<ChainPolicy>;
    /** The fee, rent and resource cap; prepare and the pre-sign reservation also check the principal caps with assertPrincipal. */
    authorize(account: ChainAccount, alias: ChainAssetAlias, maximumFee: string): Promise<ChainPolicy>;
    /** The admitted per-transfer and daily principal caps, beside the allowlist caps; this operation itself is never counted twice. */
    assertPrincipal(policy: ChainPolicy, operationId: string, amountAtomic: string): Promise<void>;
}
export declare function solanaCapabilities(): {
    rail: string;
    network: string;
    assets: import("./direct-rail-ports.js").ChainAsset[];
    x402: {
        available: boolean;
        scheme: string;
        network: `solana:${string}`;
        provider: string;
        feePayer: string;
        assets: {
            symbol: string;
            mint: string | null;
            decimals: number;
        }[];
        assetSource: string;
        refused: string[];
        requires: string[];
        commands: string[];
    };
    profiles: ({
        provider: string;
        execution: string;
        direct: boolean;
        x402: boolean;
        requires: string[];
        accountAndBalance?: never;
        blocker?: never;
    } | {
        provider: string;
        execution: string;
        direct: boolean;
        x402: boolean;
        accountAndBalance: boolean;
        blocker: string;
        requires?: never;
    } | {
        provider: string;
        direct: boolean;
        blocker: string;
        execution?: never;
        x402?: never;
        requires?: never;
        accountAndBalance?: never;
    })[];
};
