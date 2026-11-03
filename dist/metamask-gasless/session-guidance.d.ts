declare const MESSAGES: {
    readonly mm_gasless_session_expired: string;
    readonly mm_gasless_session_unavailable: string;
};
export declare function mmSessionReason(reason: unknown): reason is keyof typeof MESSAGES;
/** `mm logout` clears more than the session: said wherever a step names it. */
export declare const mmLogoutWarning: (mm: string) => string;
/**
 * Renewing the `mm` session is `mm`'s own step: `auth status` refreshes an expired token, and a new login with the
 * account that created the wallet keeps its project and address, so the profile needs no wallet connect and nothing
 * waits for the profile's unresolved operations. A failed token check is retried and then answered with a login (which
 * `mm` starts when its stored token cannot be read), never with a logout;
 * only a token MetaMask keeps refusing while `auth status` calls it active needs one, since `mm` starts a login only
 * once no active token is left. When the pinned client cannot be resolved the steps keep the bare `mm`, as the project
 * wallet refusals do.
 */
export declare function mmSessionNextActions(address: string | undefined, then?: string): Promise<string[]>;
/** A prepare refused for the `mm` session: its cause and the renewal steps, never a wallet connect. */
export declare function mmSessionGuidance(error: unknown, ownerAddress: () => Promise<string>): Promise<unknown>;
export {};
