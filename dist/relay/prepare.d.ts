import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { OperationService } from "../operation-service.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import { type RelayQuoteIntent, type ValidatedRelayQuote } from "./quote.js";
import { type RelayNativeQuoteIntent, type ValidatedRelayNativeQuote } from "./native-quote.js";
export declare const RELAY_ROUTE_REFERENCE = "ethereum-usdc-bnb-native-v1";
export interface RelayPrepareInput {
    readonly profile: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly minOutputAtomic: string;
    readonly maxApprovalNetworkFeeWei: string;
    readonly maxDepositNetworkFeeWei: string;
    readonly idempotencyKey: string;
}
export interface RelayPreparePorts {
    readonly publicAccount?: (profile: string) => Promise<string | null>;
    readonly activePolicy?: (profile: string) => Promise<ActiveAssetPolicy | null>;
    readonly dailyUsage?: (account: string, now: Date) => Promise<string>;
    readonly quote?: (intent: RelayQuoteIntent) => Promise<ValidatedRelayQuote>;
    readonly nativeQuote?: (intent: RelayNativeQuoteIntent) => Promise<ValidatedRelayNativeQuote>;
}
export interface RelayNativePrepareInput {
    readonly profile: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly minOutputAtomic: string;
    readonly maxDepositNetworkFeeWei: string;
    readonly idempotencyKey: string;
}
export declare class RelayUnsignedPrepareService {
    private readonly state;
    private readonly clock;
    private readonly operations;
    private readonly ports;
    constructor(state: StateStore, clock: ClockPort, operations?: OperationService, ports?: RelayPreparePorts);
    prepare(input: RelayPrepareInput): Promise<import("../relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
    prepareNative(input: RelayNativePrepareInput): Promise<import("../relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
}
