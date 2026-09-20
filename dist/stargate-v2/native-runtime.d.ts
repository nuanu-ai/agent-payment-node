import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "../lifi/https.js";
import { type StargateNativeOperation } from "./native-execution.js";
export declare class StargateJsonRpc {
    private readonly https;
    private sequence;
    readonly origin: string;
    private readonly endpoint;
    constructor(url: string, https?: Pick<BridgeHttps, "request">);
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
export declare class StargateNativeService {
    private readonly state;
    private readonly now;
    private readonly source;
    private readonly destination;
    private readonly journal;
    private readonly local;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, now?: () => number);
    prepare(input: Readonly<{
        profile: string;
        amountAtomic: string;
        maxNativeDebitAtomic: string;
        idempotencyKey: string;
    }>): Promise<StargateNativeOperation>;
    execute(operationId: string): Promise<StargateNativeOperation>;
    status(operationId: string): Promise<StargateNativeOperation>;
    receipt(operationId: string): Promise<import("./native-execution.js").StargateNativeCanonicalReceipt>;
    private required;
    private ports;
}
