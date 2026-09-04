export declare function canonicalErc7710Facilitators(extra: Readonly<Record<string, unknown>>): readonly string[] | null;
export declare function frozenErc7710FacilitatorsMatch(extra: Readonly<Record<string, unknown>>, frozen: unknown): boolean;
export declare function isStrictErc7710Payload(value: unknown): value is {
    readonly delegationManager: string;
    readonly permissionContext: string;
    readonly delegator: string;
};
