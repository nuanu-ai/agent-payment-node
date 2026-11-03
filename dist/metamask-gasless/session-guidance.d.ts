declare const MESSAGES: {
    readonly mm_gasless_session_expired: string;
    readonly mm_gasless_session_unavailable: string;
};
export declare function mmSessionReason(reason: unknown): reason is keyof typeof MESSAGES;
/**
 * Renewing the `mm` session is `mm`'s own step: `auth status` refreshes an expired token, and a new login with the
 * account that created the wallet keeps its project and address, so the profile needs no wallet connect and nothing
 * waits for the profile's unresolved operations. `auth status` can answer true for a token MetaMask still refuses, so a
 * repeated refusal also leads to the new login, which `mm` starts only after a logout while its token is active. When
 * the pinned client cannot be resolved the steps keep the bare `mm`, as the project wallet refusals do.
 */
export declare function mmSessionNextActions(address: string | undefined, then?: string): Promise<string[]>;
/** A prepare refused for the `mm` session: its cause and the renewal steps, never a wallet connect. */
export declare function mmSessionGuidance(error: unknown, ownerAddress: () => Promise<string>): Promise<unknown>;
export {};
