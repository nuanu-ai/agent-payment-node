declare const MESSAGES: {
    readonly mm_gasless_session_expired: string;
    readonly mm_gasless_session_unavailable: string;
};
export declare function mmSessionReason(reason: unknown): reason is keyof typeof MESSAGES;
/**
 * A prepare refused for the `mm` session. Renewing it is `mm`'s own step: `auth status` refreshes an expired token, and
 * a new login with the account that created the wallet keeps its project and address, so the profile needs no wallet
 * connect and nothing waits for the profile's unresolved operations. When the pinned client cannot be resolved the
 * steps keep the bare `mm`, as the project wallet refusals do.
 */
export declare function mmSessionGuidance(error: unknown, ownerAddress: () => Promise<string>): Promise<unknown>;
export {};
