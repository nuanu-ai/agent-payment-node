export declare const agentSdk: () => Promise<Pick<typeof import("@metamask/agent-sdk"), "NetworkRegistry" | "PriceService" | "createWalletServiceFromSession" | "disableAnalytics">>;
export declare const agentBase: () => Promise<Pick<typeof import("@metamask/agent-sdk/base"), "SessionManager" | "WalletStateManager">>;
export declare const agentEvm: () => Promise<Pick<typeof import("@metamask/agent-sdk/evm"), "getAgenticEvmChains" | "withEvmRpcTarget">>;
export declare const foxEvm: () => Promise<Pick<typeof import("@metamask/fox-sdk/wallets/evm"), "SIGN_REQUEST_KIND" | "prepareDelegation" | "executionsToWire" | "unsignedDelegationToWire" | "EvmServerAdapter" | "evmServerAdapter">>;
export declare const foxKeyring: () => Promise<Pick<typeof import("@metamask/fox-sdk/wallets/keyring"), "KEYRING_KIND" | "createKeyringController">>;
export declare const ethereumControllers: () => Promise<Pick<typeof import("@toruslabs/ethereum-controllers"), "getDelegationHashOffchain">>;
