import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { StateStore } from "../state.js";
import type { ClockPort } from "../ports.js";
export type RelayReadCall = {
    readonly method: string;
    readonly params: readonly unknown[];
};
export interface RelayPreflightPorts {
    readonly batch: (calls: readonly RelayReadCall[]) => Promise<readonly unknown[]>;
    readonly activePolicy?: (profile: string) => Promise<ActiveAssetPolicy | null>;
    readonly publicAccount?: (profile: string) => Promise<string | null>;
    readonly dailyUsage?: (account: string, now: Date) => Promise<string>;
}
export declare class RelayReadOnlyPreflightService {
    private readonly state;
    private readonly clock;
    private readonly ports;
    constructor(state: StateStore, clock: ClockPort, ports: RelayPreflightPorts);
    preflight(input: {
        readonly profile: string;
        readonly operationId: string;
    }): Promise<{
        kind: "relay_read_only_source_preflight";
        operationId: string;
        profile: string;
        sourceChainId: 1;
        sourceAccount: string;
        token: string;
        spender: string;
        observedHeadBlockNumber: string;
        observedHeadBlockHash: `0x${string}`;
        observationBlockHash: `0x${string}`;
        rpcBatches: 2;
        rpcMethods: 6;
        nativeBalanceWei: string;
        tokenBalanceAtomic: string;
        allowanceAtomic: string;
        principalAtomic: string;
        approvalNetworkFeeCeilingWei: string;
        depositNetworkFeeCeilingWei: string;
        requiredNativeWei: string;
        approvalRequired: boolean;
        fundingReasons: string[];
        fundingObserved: boolean;
        proofClass: "read_only_rpc_observation";
        executionAdmitted: false;
        nextActions: readonly [];
    }>;
}
