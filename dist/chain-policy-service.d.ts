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
    authorize(account: ChainAccount, alias: ChainAssetAlias, amount: string, maximumFee: string, excluding?: string): Promise<ChainPolicy>;
}
export declare function solanaCapabilities(): {
    rail: string;
    network: string;
    assets: import("./direct-rail-ports.js").ChainAsset[];
    x402: {
        available: boolean;
    };
    profiles: ({
        provider: string;
        execution: string;
        direct: boolean;
        requires: string[];
        accountAndBalance?: never;
        blocker?: never;
    } | {
        provider: string;
        execution: string;
        direct: boolean;
        accountAndBalance: boolean;
        blocker: string;
        requires?: never;
    } | {
        provider: string;
        direct: boolean;
        blocker: string;
        execution?: never;
        requires?: never;
        accountAndBalance?: never;
    })[];
};
