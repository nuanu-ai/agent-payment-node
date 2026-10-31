type ProjectWalletReason = "mm_gasless_project_has_no_wallets" | "mm_gasless_wallet_not_in_project";
/** A refusal proving the MetaMask login's project does not hold the profile's server wallet (client/project-wallets.ts). */
export interface MmProjectWalletRefusal {
    readonly reason: ProjectWalletReason;
    readonly profile: string;
    /** The profile's bound server wallet. */
    readonly address: string;
    /** The profile's current revision, which a connect to another address must name. */
    readonly revision: number;
    /** The project's other EVM server wallets, when the refusal counted them. */
    readonly otherWallets: number | undefined;
}
export declare function mmProjectWalletReason(reason: unknown): reason is ProjectWalletReason;
/**
 * The owner's two ways forward, each step runnable as typed. Signing in with the account that created the wallet keeps
 * the bound address, so its connect needs no revision; any other wallet is a new address, so its connect names the
 * current revision (a rebind). Neither moves funds. `mm init` creates a wallet only in a project that has none: in one
 * that has some it selects one of them and keeps its server-side trading mode. When the pinned client cannot be
 * resolved its steps keep the bare `mm`, as the native transfer refusals do.
 */
export declare function mmProjectWalletNextActions(refusal: MmProjectWalletRefusal): Promise<string[]>;
/** A prepare refused for the login's project: the provider's answer with both ways forward. */
export declare function mmProjectWalletGuidance(error: unknown, profile: string): Promise<unknown>;
export {};
