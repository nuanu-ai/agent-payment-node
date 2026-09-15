import { ApnError } from "../errors.js";
import { assertGaslessSnapshot } from "./economics.js";
import { assertGaslessOwner } from "./owner.js";
import { GASLESS_MIN_REMAINING_MS, assertGaslessExecutionChain, gaslessFailure } from "./validation.js";
import { gaslessWireFees } from "./wire.js";
export function assertGaslessRemaining(op, now) {
    if (!Number.isSafeInteger(now) || now < Date.parse(op.createdAt) ||
        Date.parse(op.intent.expiresAt) - now < GASLESS_MIN_REMAINING_MS) {
        gaslessFailure("APN_OPERATION_BLOCKED", "gasless_action_expired");
    }
}
/**
 * Returns the fees the next step uses. Until its UserOperation is signed, a v4 operation is priced from fresh bundler
 * quotes within the owner's fee cap; signed fees, and every earlier intent's frozen fees, must cover the current slow tier.
 */
export async function guardGaslessOperation(state, rpc, op, now, signed) {
    assertGaslessExecutionChain(op.intent.request.chainId);
    assertGaslessRemaining(op, now());
    await assertGaslessOwner(state, op.intent);
    const s = op.intent.initialSnapshot;
    if (rpc.chainId !== op.intent.request.chainId || rpc.rpcOrigin !== s.rpcOrigin ||
        rpc.rpcEndpointHash !== s.rpcEndpointHash || rpc.bundlerOrigin !== s.bundlerOrigin ||
        rpc.bundlerEndpointHash !== s.bundlerEndpointHash)
        gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
    const fresh = op.intent.wireVersion === "apn.gasless-wire.v4" && signed === undefined;
    const approved = fresh ? undefined : { ...op.intent.gas, ...gaslessWireFees(op.intent, signed) };
    const current = await rpc.snapshot(op.intent.owner.address, approved);
    const fees = gaslessWireFees(op.intent, approved ?? { maxFeePerGas: current.maxFeePerGas, maxPriorityFeePerGas: current.maxPriorityFeePerGas });
    assertGaslessSnapshot(op.intent, current, fees);
    await assertGaslessOwner(state, op.intent);
    assertGaslessRemaining(op, now());
    return fees;
}
/** Only reason tokens produced by this module family may enter the durable journal. */
export function gaslessReason(error, fallback) {
    if (error instanceof ApnError) {
        const match = /^Gasless validation failed: (gasless_[a-z0-9_]{1,87})\.$/u.exec(error.message);
        if (match !== null)
            return match[1];
        if (error.code === "APN_PROFILE_DRIFT")
            return "gasless_identity_drift";
    }
    return fallback;
}
//# sourceMappingURL=guard.js.map