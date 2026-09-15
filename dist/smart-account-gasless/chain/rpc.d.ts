import type { ClockPort } from "../../ports.js";
import { type GaslessTransport } from "../../gasless/https.js";
import type { SmartAccountGaslessBinding, SmartAccountGaslessBlock, SmartAccountGaslessMaterialDescriptor, SmartAccountGaslessSnapshot } from "../model.js";
import type { SmartAccountGaslessMaterialValidatorPort, SmartAccountGaslessRpcFactory, SmartAccountGaslessRpcPort, SmartAccountGaslessObserveInput } from "../ports.js";
export interface SmartAccountGaslessRpcPacing {
    readonly minimumIntervalMs: number;
    monotonicNow(): number;
    sleep(milliseconds: number): Promise<void>;
}
export interface SmartAccountGaslessRpcOptions {
    readonly chainId: 8453;
    readonly rpcUrl: string;
    readonly clock: ClockPort;
    readonly validator: SmartAccountGaslessMaterialValidatorPort;
    readonly transport?: GaslessTransport;
    readonly pacing?: SmartAccountGaslessRpcPacing;
}
/** Lazy binding performs no RPC, custody, provider or chain effect. */
export declare function smartAccountGaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>, clock: ClockPort, validator: SmartAccountGaslessMaterialValidatorPort, transport?: GaslessTransport): SmartAccountGaslessRpcFactory;
export declare class SmartAccountGaslessRpc implements SmartAccountGaslessRpcPort {
    readonly chainId: 8453;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly rpcUrl: string;
    private readonly clock;
    private readonly validator;
    private readonly transport;
    private readonly pacing;
    private sequence;
    private queue;
    private lastRequestStartedAt;
    constructor(options: SmartAccountGaslessRpcOptions);
    snapshot(binding: SmartAccountGaslessBinding, expectedPreparationBlock?: SmartAccountGaslessBlock): Promise<SmartAccountGaslessSnapshot>;
    assertUnspent(input: {
        readonly binding: SmartAccountGaslessBinding;
        readonly material: SmartAccountGaslessMaterialDescriptor;
        readonly safeBlock: SmartAccountGaslessBlock;
    }): Promise<void>;
    observe(input: SmartAccountGaslessObserveInput): Promise<import("../model.js").SmartAccountGaslessRpcObservation>;
    private assertInput;
    private assertChain;
    private pass;
    private call;
    private performCall;
    private schedule;
}
