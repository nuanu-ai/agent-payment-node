import type { GaslessIntent, GaslessObservationSource } from "./model.js";
import type { GaslessObservationPort } from "./ports.js";
export declare function gaslessObservationRpcEnv(value: unknown): string;
export declare function gaslessObservationSource(intent: GaslessIntent, environmentName: string, rpc: Pick<GaslessObservationPort, "rpcOrigin" | "rpcEndpointHash">): GaslessObservationSource;
/** Durable source metadata is bound to the immutable intent, never to current environment contents. */
export declare function assertGaslessObservationSource(intent: GaslessIntent, source: GaslessObservationSource): void;
