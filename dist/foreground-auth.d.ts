import type { ForegroundAuthenticationPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export interface AuthTerminal {
    readonly fd: number;
    write(contents: string): Promise<void>;
    readLine(): Promise<Buffer>;
    readSecretLine(): Promise<Buffer>;
    close(): Promise<void>;
}
export interface TtyForegroundAuthenticationOptions {
    readonly openTerminal?: () => Promise<AuthTerminal>;
    readonly isTerminal?: (fd: number) => boolean;
}
export declare class TtyForegroundAuthentication implements ForegroundAuthenticationPort {
    private readonly openTerminal;
    private readonly isTerminal;
    constructor(options?: TtyForegroundAuthenticationOptions);
    readIdentity(): Promise<string>;
    readChallengeResponse(): Promise<string>;
    confirmRebind(input: {
        readonly profile: string;
        readonly revision: number;
        readonly current_address: `0x${string}`;
        readonly observed_address: `0x${string}`;
        readonly current_capability_hash: string;
        readonly observed_capability_hash: string;
        readonly current_trust_class: ProviderProfileRecord["trust_class"];
        readonly observed_trust_class: ProviderProfileRecord["trust_class"];
    }): Promise<boolean>;
    private prompt;
}
export declare function readSecretLine(input: NodeJS.ReadStream, signals?: Pick<NodeJS.Process, "once" | "off">): Promise<Buffer>;
