import { GASLESS_ZERO_ADDRESS, gaslessAddress, gaslessFailure, gaslessUint } from "./validation.js";
/** Shared command surface only; each provider retains its own strict persisted schema. */
export const GASLESS_COMMAND_CHAINS = [1, 10, 130, 137, 143, 1329, 8453, 42161, 43114, 59144];
export function gaslessCommandChain(value) {
    if (!GASLESS_COMMAND_CHAINS.includes(value))
        gaslessFailure("APN_INVALID_INPUT", "gasless_chain_unsupported");
    return value;
}
export function gaslessCommandRequest(request) {
    gaslessCommandChain(request.chainId);
    if (gaslessAddress(request.recipient, "APN_INVALID_INPUT") !== request.recipient || request.recipient === GASLESS_ZERO_ADDRESS) {
        gaslessFailure("APN_INVALID_INPUT", "gasless_recipient");
    }
    const gross = gaslessUint(request.grossAtomic, true, "APN_INVALID_INPUT");
    const minimum = gaslessUint(request.minReceivedAtomic, true, "APN_INVALID_INPUT");
    gaslessUint(request.maxFeeAtomic, false, "APN_INVALID_INPUT");
    if (gross <= 0n || minimum <= 0n || minimum > gross)
        gaslessFailure("APN_INVALID_INPUT", "gasless_amount_bounds");
    return request;
}
//# sourceMappingURL=command-input.js.map