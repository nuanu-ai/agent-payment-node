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
