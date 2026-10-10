import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "./https.js";
import { type SeiFundingRecord } from "./sei-gaszip-journal.js";
import { type SeiRpcPort } from "./sei-gaszip-rpc.js";
export interface SeiFundingPrepareRequest {
    readonly profile: string;
    readonly expectedPayer: string;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maximumFeeAtomic: string;
    readonly idempotencyKey: string;
}
export interface SeiFundingPorts {
    readonly https?: Pick<BridgeHttps, "request">;
    readonly source?: () => SeiRpcPort;
    readonly destination?: () => SeiRpcPort;
    readonly approve?: (record: SeiFundingRecord) => Promise<void>;
    readonly now?: () => number;
}
/** Strictly Base-native to Sei-native, self recipient; adapters cannot supply authoritative receipts in place of RPC reads. */
export declare class SeiFundingService {
    private readonly state;
    private readonly wrapping;
    private readonly environment;
    private readonly ports;
    private readonly journal;
    private readonly ledger;
    private readonly https;
    private readonly now;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, ports?: SeiFundingPorts);
    private rpc;
    private identity;
    private policy;
    private required;
    private locks;
    prepare(input: SeiFundingPrepareRequest): Promise<unknown>;
    approve(id: string): Promise<unknown>;
    private usage;
    status(id: string): Promise<unknown>;
}
