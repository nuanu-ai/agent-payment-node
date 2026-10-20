import { getAddress } from "viem";
import type { Address, Hex } from "./model.js";
import { EIP2612_PERMIT_TYPES, PERMIT2_WITNESS_TYPES } from "./x402-permit2/authorization.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./x402-permit2/registry.js";

/**
 * Unattended x402 `exact` payments with `assetTransferMethod: "permit2"` inside the standard x402 lane. The operation's
 * frozen EIP-3009-shaped authorization (from, to, value, validBefore, a 32-byte random nonce) is the Permit2 witness
 * transfer: the nonce is Permit2's unordered nonce and validBefore its deadline. These builders are the one source of
 * the typed data custody signs and the verifier recovers, and of the wire payload the seller receives; they produce
 * exactly what the foreground Permit2 lane's planner and wire codec produce for the same terms.
 */
export interface X402Permit2Terms {
  readonly chainId: number;
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly value: string;
  /** 32-byte hex; as a uint256 it is the Permit2 unordered nonce. */
  readonly nonce: string;
  readonly deadline: string;
}
/** A seller-sponsored exact-amount EIP-2612 permit to Permit2: the token's own EIP-712 name/version and permit nonce. */
export interface X402Eip2612Terms { readonly name: string; readonly version: string; readonly nonce: string }

export function x402Permit2TypedData(terms: X402Permit2Terms) {
  return {
    domain: { name: "Permit2", chainId: terms.chainId, verifyingContract: PERMIT2_ADDRESS },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: { token: getAddress(terms.token), amount: BigInt(terms.value) }, spender: X402_EXACT_PERMIT2_PROXY,
      nonce: BigInt(terms.nonce), deadline: BigInt(terms.deadline), witness: { to: getAddress(terms.to), validAfter: 0n },
    },
  };
}

export function x402Eip2612TypedData(terms: X402Permit2Terms, permit: X402Eip2612Terms) {
  return {
    domain: { name: permit.name, version: permit.version, chainId: terms.chainId, verifyingContract: getAddress(terms.token) },
    types: EIP2612_PERMIT_TYPES,
    primaryType: "Permit" as const,
    // Exactly the payment amount to Permit2, never an unlimited approval.
    message: { owner: getAddress(terms.from), spender: PERMIT2_ADDRESS, value: BigInt(terms.value), nonce: BigInt(permit.nonce),
      deadline: BigInt(terms.deadline) },
  };
}

/** The x402 v2 Permit2 `payload.permit2Authorization` for these terms. */
export function x402Permit2Authorization(terms: X402Permit2Terms) {
  return { from: getAddress(terms.from) as Address, permitted: { token: getAddress(terms.token) as Address, amount: terms.value },
    spender: X402_EXACT_PERMIT2_PROXY, nonce: BigInt(terms.nonce).toString(), deadline: terms.deadline,
    witness: { to: getAddress(terms.to) as Address, validAfter: "0" as const } };
}

/** The `eip2612GasSponsoring` extension info the seller's facilitator submits before settling. */
export function x402Eip2612Info(terms: X402Permit2Terms, permit: X402Eip2612Terms, signature: Hex) {
  return { from: getAddress(terms.from) as Address, asset: getAddress(terms.token) as Address, spender: PERMIT2_ADDRESS,
    amount: terms.value, nonce: permit.nonce, deadline: terms.deadline, version: "1" as const, signature };
}
