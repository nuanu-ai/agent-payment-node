import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "./https.js";
import { type GaszipDirectRoute } from "./gaszip-direct-route.js";
import { type GaszipFundingRecord } from "./gaszip-direct-journal.js";
import { type GaszipRpcPort } from "./gaszip-direct-rpc.js";
export interface GaszipFundingPrepareRequest {
    readonly profile: string;
    readonly expectedPayer: string;
    readonly amountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly maximumFeeAtomic: string;
    readonly idempotencyKey: string;
}
export interface GaszipFundingPorts {
    readonly https?: Pick<BridgeHttps, "request">;
    readonly source?: () => GaszipRpcPort;
    readonly destination?: () => GaszipRpcPort;
    readonly approve?: (record: GaszipFundingRecord) => Promise<void>;
    readonly now?: () => number;
}
/** Strictly Base native to the payer's own destination native balance; adapters cannot supply authoritative receipts in place of RPC reads. */
export declare class GaszipFundingService {
    readonly route: GaszipDirectRoute;
    private readonly state;
    private readonly wrapping;
    private readonly environment;
    private readonly ports;
    private readonly journal;
    private readonly ledger;
    private readonly https;
    private readonly now;
    private readonly c;
    constructor(route: GaszipDirectRoute, state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, ports?: GaszipFundingPorts);
    private rpc;
    private publicRecord;
    private seal;
    private identity;
    private policy;
    private required;
    private locks;
    prepare(input: GaszipFundingPrepareRequest): Promise<unknown>;
    approve(id: string): Promise<unknown>;
    private usage;
    /** A signed effect APN proved never landed ends before effect: its bytes are scrubbed and never sent again. */
    private unlanded;
    private retireUnlanded;
    status(id: string): Promise<unknown>;
}
