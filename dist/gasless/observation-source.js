import { hashObject } from "../canonical.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { observationSourceSchema } from "./schema.js";
import { gaslessFailure, gaslessSame } from "./validation.js";
export function gaslessObservationRpcEnv(value) {
    if (typeof value !== "string" || value.length > 128 || !/^APN_[A-Z0-9_]+_RPC_URL$/u.test(value)) {
        gaslessFailure("APN_INVALID_INPUT", "gasless_observation_rpc_env");
    }
    return value;
}
export function gaslessObservationSource(intent, environmentName, rpc) {
    const source = { policy: "apn.gasless.observation-rpc.v1",
        environmentName: gaslessObservationRpcEnv(environmentName), rpcOrigin: rpc.rpcOrigin,
        rpcEndpointHash: rpc.rpcEndpointHash, intentHash: hashObject(intent), initialBlock: intent.initialSnapshot.block };
    assertGaslessObservationSource(intent, source);
    return source;
}
/** Durable source metadata is bound to the immutable intent, never to current environment contents. */
export function assertGaslessObservationSource(intent, source) {
    if (!observationSourceSchema.safeParse(source).success || source.intentHash !== hashObject(intent) ||
        !gaslessSame(source.initialBlock, intent.initialSnapshot.block)) {
        gaslessFailure("APN_STATE_CORRUPT", "gasless_observation_source_binding");
    }
    try {
        if (parsePublicHttpsUrl(source.rpcOrigin, "APN_RPC_CONFIG", "Observation RPC origin", 256).origin !== source.rpcOrigin) {
            throw new Error("origin");
        }
    }
    catch {
        gaslessFailure("APN_STATE_CORRUPT", "gasless_observation_source_binding");
    }
}
//# sourceMappingURL=observation-source.js.map