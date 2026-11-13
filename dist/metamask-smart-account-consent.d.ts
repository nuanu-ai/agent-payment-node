import type { Address } from "./model.js";
/**
 * MetaMask keeps an Advanced Permission for the exact origin that requested it and lists it only to that origin, so the
 * consent page of one permission is always served from the same loopback port: the one its record saved.
 */
export interface SmartAccountConsentRequest {
    readonly port: number;
    readonly sessionAddress: Address;
    readonly capAtomic: string;
    readonly startsAtUnix: number;
    readonly expiresAtUnix: number;
    /**
     * The intent's consent ran before: the page then first reads the grants its origin holds, since an earlier answer may
     * never have reached APN. A first consent skips the read, because a session account made for it holds no grant.
     */
    readonly retry?: boolean;
}
export interface SmartAccountConsentSync {
    readonly port: number;
    readonly ownerAddress: Address;
}
/** A loopback port the system has free now, for a new permission's consent origin; the caller saves it before use. */
export declare function allocateConsentPort(): Promise<number>;
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
