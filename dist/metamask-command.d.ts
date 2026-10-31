/**
 * `mm` written as the pinned client run by APN's own Node, as a shell command prefix: Homebrew links only `apn`, so a
 * bare `mm` is not on the owner's PATH.
 */
export declare function metaMaskCommand(): Promise<string>;
