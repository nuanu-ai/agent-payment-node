import type { Address, Hex } from "../model.js";
import type { Permit2OfferSelection } from "./offer.js";
export declare const EIP2612_GAS_SPONSORING: "eip2612GasSponsoring";
/** Must equal the x402 exact proxy's witness layout; the test suite cross-checks it against @x402/evm. */
export declare const PERMIT2_WITNESS_TYPES: {
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
export declare const EIP2612_PERMIT_TYPES: {
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
export interface Permit2Authorization {
    readonly from: Address;
    readonly permitted: {
        readonly token: Address;
        readonly amount: string;
    };
    readonly spender: Address;
    readonly nonce: string;
    readonly deadline: string;
    readonly witness: {
        readonly to: Address;
        readonly validAfter: "0";
    };
}
export interface Eip2612PermitInfo {
    readonly from: Address;
    readonly asset: Address;
    readonly spender: Address;
    readonly amount: string;
    readonly nonce: string;
    readonly deadline: string;
    readonly version: "1";
}
export interface Permit2TypedData {
    readonly domain: Readonly<Record<string, string | number>>;
    readonly types: typeof PERMIT2_WITNESS_TYPES | typeof EIP2612_PERMIT_TYPES;
    readonly primaryType: "PermitWitnessTransferFrom" | "Permit";
    readonly message: Readonly<Record<string, unknown>>;
}
/** What the owner approves: one Permit2 witness transfer and, only when allowance is short, one exact-amount EIP-2612 permit. */
export interface Permit2SigningPlan {
    readonly selection: Permit2OfferSelection;
    readonly authorization: Permit2Authorization;
    readonly permit2: Permit2TypedData;
    readonly eip2612: {
        readonly info: Eip2612PermitInfo;
        readonly typedData: Permit2TypedData;
    } | null;
    readonly planHash: string;
}
/** Local custody signs the exact typed data; nothing else in this rail holds key material. */
export interface Permit2SignerPort {
    signPermit2Material(address: Address, typedData: Permit2TypedData): Promise<Hex>;
}
export interface Permit2PlanInput {
    readonly payer: Address;
    readonly nowSeconds: number;
    /** 256-bit random unordered Permit2 nonce, drawn by the caller from a CSPRNG. */
    readonly nonce: bigint;
    /** allowance(payer, Permit2) read at prepare from the admitted chain. */
    readonly permit2AllowanceAtomic: string;
    /** nonces(payer) of the token, read at prepare; required only when the permit is needed. */
    readonly eip2612Nonce: bigint | null;
    /** True only when the seller's 402 advertised the `eip2612GasSponsoring` extension. */
    readonly sellerSponsorsEip2612: boolean;
}
export declare function planPermit2Authorization(selection: Permit2OfferSelection, input: Permit2PlanInput): Permit2SigningPlan;
/** The exact x402 v2 PaymentPayload. Each signature must recover to the payer before anything can leave APN. */
export declare function assemblePermit2Payment(plan: Permit2SigningPlan, signer: Permit2SignerPort): Promise<unknown>;
