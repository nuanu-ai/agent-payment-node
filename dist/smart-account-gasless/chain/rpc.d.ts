import type { ClockPort } from "../../ports.js";
import { type GaslessTransport } from "../../gasless/https.js";
import type { SmartAccountGaslessBinding, SmartAccountGaslessBlock, SmartAccountGaslessMaterialDescriptor, SmartAccountGaslessSnapshot } from "../model.js";
import type { SmartAccountGaslessMaterialValidatorPort, SmartAccountGaslessObservationRpcFactory, SmartAccountGaslessRpcFactory, SmartAccountGaslessRpcPort, SmartAccountGaslessObserveInput } from "../ports.js";
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
    /** Observe saved operations only: prove the chain and the frozen anchor instead of the frozen endpoint identity. */
    readonly observationOnly?: boolean;
}
/** Lazy binding performs no RPC, custody, provider or chain effect. */
export declare function smartAccountGaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>, clock: ClockPort, validator: SmartAccountGaslessMaterialValidatorPort, transport?: GaslessTransport): SmartAccountGaslessRpcFactory;
/** An owner-named RPC that observes saved operations only; it never serves pre-exposure snapshots or spent checks. */
export declare function smartAccountGaslessObservationRpcFactory(environment: Readonly<Record<string, string | undefined>>, clock: ClockPort, validator: SmartAccountGaslessMaterialValidatorPort, transport?: GaslessTransport): SmartAccountGaslessObservationRpcFactory;
export declare function saObservationRpcEnv(value: unknown): string;
export declare class SmartAccountGaslessRpc implements SmartAccountGaslessRpcPort {
    readonly chainId: 8453;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly rpcUrl: string;
    private readonly clock;
    private readonly validator;
    private readonly transport;
    private readonly observationOnly;
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
