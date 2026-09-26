export declare function readPermit2IntentStatus(root: string, requestedProfile: string, operationId: string): Promise<{
    operationId: string;
    profile: string;
    state: "not_found";
    capability: "execution_blocked";
    blockerCodes: string[];
    chain?: never;
    token?: never;
    owner?: never;
    recipient?: never;
} | {
    operationId: string;
    profile: string;
    chain: "eip155:43114";
    token: string;
    owner: string;
    recipient: string;
    state: "execution_blocked";
    capability: "execution_blocked";
    blockerCodes: string[];
}>;
