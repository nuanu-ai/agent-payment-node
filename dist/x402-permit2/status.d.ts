/** Read-only status of one real Permit2 operation from the production journal: no initialization, locks, repair or network. */
export declare function readPermit2ProductionStatus(root: string, requestedProfile: string, operationId: string): Promise<{
    operationId: string;
    profile: string;
    state: "not_found";
} | {
    lifecycle: string;
    observeOnly: boolean;
    operationId: string;
    state: "prepared" | "reserved" | "released_unsubmitted" | "settled" | "reserving" | "release_pending" | "exposure_unknown" | "request_pending" | "terminal_pending" | "expired_no_effect";
    terminal: boolean;
    capability: string;
    chain: `eip155:${number}`;
    payer: `0x${string}`;
    token: `0x${string}`;
    recipient: `0x${string}`;
    amountAtomic: string;
    deadline: string;
    resource: {
        origin: string;
        urlHash: string;
    };
    blockerCodes: string[];
    profile: string;
}>;
