import { getAddress } from "viem";
import { EIP2612_PERMIT_TYPES, PERMIT2_WITNESS_TYPES } from "./x402-permit2/authorization.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./x402-permit2/registry.js";
export function x402Permit2TypedData(terms) {
    return {
        domain: { name: "Permit2", chainId: terms.chainId, verifyingContract: PERMIT2_ADDRESS },
        types: PERMIT2_WITNESS_TYPES,
        primaryType: "PermitWitnessTransferFrom",
        message: {
            permitted: { token: getAddress(terms.token), amount: BigInt(terms.value) }, spender: X402_EXACT_PERMIT2_PROXY,
            nonce: BigInt(terms.nonce), deadline: BigInt(terms.deadline), witness: { to: getAddress(terms.to), validAfter: 0n },
        },
    };
}
export function x402Eip2612TypedData(terms, permit) {
    return {
        domain: { name: permit.name, version: permit.version, chainId: terms.chainId, verifyingContract: getAddress(terms.token) },
        types: EIP2612_PERMIT_TYPES,
        primaryType: "Permit",
        // Exactly the payment amount to Permit2, never an unlimited approval.
        message: { owner: getAddress(terms.from), spender: PERMIT2_ADDRESS, value: BigInt(terms.value), nonce: BigInt(permit.nonce),
            deadline: BigInt(terms.deadline) },
    };
}
/** The x402 v2 Permit2 `payload.permit2Authorization` for these terms. */
export function x402Permit2Authorization(terms) {
    return { from: getAddress(terms.from), permitted: { token: getAddress(terms.token), amount: terms.value },
        spender: X402_EXACT_PERMIT2_PROXY, nonce: BigInt(terms.nonce).toString(), deadline: terms.deadline,
        witness: { to: getAddress(terms.to), validAfter: "0" } };
}
/** The `eip2612GasSponsoring` extension info the seller's facilitator submits before settling. */
export function x402Eip2612Info(terms, permit, signature) {
    return { from: getAddress(terms.from), asset: getAddress(terms.token), spender: PERMIT2_ADDRESS,
        amount: terms.value, nonce: permit.nonce, deadline: terms.deadline, version: "1", signature };
}
//# sourceMappingURL=x402-permit2-exact.js.map