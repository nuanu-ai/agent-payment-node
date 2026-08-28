export interface WrappingSecretPort {
    load(): Promise<Buffer | null>;
    create(): Promise<Buffer>;
}
interface LocalIdentity {
    readonly homedir: string;
    readonly username: string;
}
export interface SecurityResult {
    readonly code: number;
    readonly stdout: Buffer;
}
export type SecurityRunner = (args: readonly string[], input?: Buffer) => Promise<SecurityResult>;
export interface MacOSLoginKeychainSecretOptions {
    readonly identity?: LocalIdentity;
    readonly runSecurity?: SecurityRunner;
}
export declare class MacOSLoginKeychainSecret implements WrappingSecretPort {
    private readonly loginKeychain;
    private readonly security;
    constructor(options?: MacOSLoginKeychainSecretOptions);
    load(): Promise<Buffer | null>;
    create(): Promise<Buffer>;
}
export declare function loginKeychainPath(homedir: string): string;
export {};
