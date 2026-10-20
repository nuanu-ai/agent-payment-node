import type { Address, Hex } from "./model.js";
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
export interface X402Eip2612Terms {
    readonly name: string;
    readonly version: string;
    readonly nonce: string;
}
export declare function x402Permit2TypedData(terms: X402Permit2Terms): {
    domain: {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    types: {
        readonly PermitWitnessTransferFrom: readonly [{
            readonly name: "permitted";
            readonly type: "TokenPermissions";
        }, {
            readonly name: "spender";
            readonly type: "address";
        }, {
            readonly name: "nonce";
            readonly type: "uint256";
        }, {
            readonly name: "deadline";
            readonly type: "uint256";
        }, {
            readonly name: "witness";
            readonly type: "Witness";
        }];
        readonly TokenPermissions: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
        }];
        readonly Witness: readonly [{
            readonly name: "to";
            readonly type: "address";
        }, {
            readonly name: "validAfter";
            readonly type: "uint256";
        }];
    };
    primaryType: "PermitWitnessTransferFrom";
    message: {
        permitted: {
            token: `0x${string}`;
            amount: bigint;
        };
        spender: `0x${string}`;
        nonce: bigint;
        deadline: bigint;
        witness: {
            to: `0x${string}`;
            validAfter: bigint;
        };
    };
};
export declare function x402Eip2612TypedData(terms: X402Permit2Terms, permit: X402Eip2612Terms): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    types: {
        readonly Permit: readonly [{
            readonly name: "owner";
            readonly type: "address";
        }, {
            readonly name: "spender";
            readonly type: "address";
        }, {
            readonly name: "value";
            readonly type: "uint256";
        }, {
            readonly name: "nonce";
            readonly type: "uint256";
        }, {
            readonly name: "deadline";
            readonly type: "uint256";
        }];
    };
    primaryType: "Permit";
    message: {
        owner: `0x${string}`;
        spender: `0x${string}`;
        value: bigint;
        nonce: bigint;
        deadline: bigint;
    };
};
/** The x402 v2 Permit2 `payload.permit2Authorization` for these terms. */
export declare function x402Permit2Authorization(terms: X402Permit2Terms): {
    from: Address;
    permitted: {
        token: Address;
        amount: string;
    };
    spender: `0x${string}`;
    nonce: string;
    deadline: string;
    witness: {
        to: Address;
        validAfter: "0";
    };
};
/** The `eip2612GasSponsoring` extension info the seller's facilitator submits before settling. */
export declare function x402Eip2612Info(terms: X402Permit2Terms, permit: X402Eip2612Terms, signature: Hex): {
    from: Address;
    asset: Address;
    spender: `0x${string}`;
    amount: string;
    nonce: string;
    deadline: string;
    version: "1";
    signature: `0x${string}`;
};
