import type { HttpObservation } from "../x402-model.js";
import type { Permit2NativeDispatchExecution } from "./production-native-capability.js";
/** Concrete single-attempt transport. Only the actual native's private dispatch execution admits it. */
export declare class Permit2ProductionHttps {
    submit(execution: Permit2NativeDispatchExecution): Promise<HttpObservation>;
}
