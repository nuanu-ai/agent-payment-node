import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "./https.js";
import { type MegaFundingRecord } from "./mega-gaszip-journal.js";
import { type MegaRpcPort } from "./mega-gaszip-rpc.js";
export interface MegaFundingPrepareRequest {
    readonly profile: string;
    readonly expectedPayer: string;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maximumFeeAtomic: string;
    readonly idempotencyKey: string;
}
export interface MegaFundingPorts {
    readonly https?: Pick<BridgeHttps, "request">;
    readonly source?: () => MegaRpcPort;
    readonly destination?: () => MegaRpcPort;
    readonly approve?: (record: MegaFundingRecord) => Promise<void>;
    readonly now?: () => number;
}
/** Strictly Base-native to Mega-native, self recipient; adapters cannot supply authoritative receipts in place of RPC reads. */
export declare class MegaFundingService {
    private readonly state;
    private readonly wrapping;
    private readonly environment;
    private readonly ports;
    private readonly journal;
    private readonly ledger;
    private readonly https;
    private readonly now;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, ports?: MegaFundingPorts);
    private rpc;
    private identity;
    private policy;
    private required;
    private locks;
    prepare(input: MegaFundingPrepareRequest): Promise<unknown>;
    approve(id: string): Promise<unknown>;
    private usage;
    status(id: string): Promise<unknown>;
}
