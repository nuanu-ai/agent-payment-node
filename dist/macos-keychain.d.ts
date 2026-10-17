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
/**
 * The login-Keychain wrapping secret. One instance belongs to one command invocation: the first successful `load` or
 * `create` keeps a private in-memory copy for that instance, so every later read in the same command spawns no
 * `security` process. It is never written anywhere, callers still receive (and zero) their own copy, and the cached
 * copy is zeroed when the instance is collected or the process exits.
 */
export declare class MacOSLoginKeychainSecret implements WrappingSecretPort {
    private readonly loginKeychain;
    private readonly security;
    private cached;
    constructor(options?: MacOSLoginKeychainSecretOptions);
    load(): Promise<Buffer | null>;
    private remember;
    create(): Promise<Buffer>;
    private findArgs;
}
export declare function loginKeychainPath(homedir: string): string;
export {};
