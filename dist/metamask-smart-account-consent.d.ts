import type { Address } from "./model.js";
export interface SmartAccountConsentRequest {
    readonly sessionAddress: Address;
    readonly capAtomic: string;
    readonly startsAtUnix: number;
    readonly expiresAtUnix: number;
}
export interface SmartAccountConsentSync {
    readonly ownerAddress: Address;
}
export interface SmartAccountConsentPort {
    request(input: SmartAccountConsentRequest): Promise<unknown>;
    sync(input: SmartAccountConsentSync): Promise<unknown>;
}
export type BrowserOpenPort = (url: string) => Promise<void>;
export declare class LoopbackMetaMaskConsent implements SmartAccountConsentPort {
    private readonly openBrowser;
    private readonly deadlineMs;
    constructor(openBrowser?: BrowserOpenPort, deadlineMs?: number);
    request(input: SmartAccountConsentRequest): Promise<unknown>;
    sync(input: SmartAccountConsentSync): Promise<unknown>;
    private run;
    private handle;
}
/**
 * The page's last step: choosing the injected provider, the wallet method whose call or answer stopped it, or the sync
 * comparison of the selected account with the bound owner (`owner_match`).
 */
export declare const CONSENT_STEPS: readonly ["provider_choice", "eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "eth_accounts", "wallet_getSupportedExecutionPermissions", "eth_getCode", "wallet_getGrantedExecutionPermissions", "wallet_requestExecutionPermissions", "owner_match"];
