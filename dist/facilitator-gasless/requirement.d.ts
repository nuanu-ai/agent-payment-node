import type { Address, Hex } from "../model.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
/** The x402 v2 `exact` requirement APN builds itself; no seller challenge or resource exists. */
export interface FacilitatorRequirement {
    readonly scheme: "exact";
    readonly network: typeof R.network;
    readonly amount: string;
    readonly asset: Address;
    readonly payTo: Address;
    readonly maxTimeoutSeconds: number;
    readonly extra: {
        readonly assetTransferMethod: "eip3009";
        readonly name: string;
        readonly version: string;
    };
}
export interface FacilitatorAuthorization {
    readonly from: Address;
    readonly to: Address;
    readonly value: string;
    readonly validAfter: "0";
    readonly validBefore: string;
    readonly nonce: Hex;
}
export declare function facilitatorRequirement(recipient: string, amountAtomic: string): FacilitatorRequirement;
/** A fresh random nonce and a validity window that starts now; nothing is signed here. */
export declare function newFacilitatorAuthorization(owner: string, requirement: FacilitatorRequirement, nowMs: number, nonce?: Hex): FacilitatorAuthorization;
/** The EIP-712 message the owner signs: Circle `TransferWithAuthorization` on native Avalanche USDC. */
export declare function facilitatorTypedData(authorization: FacilitatorAuthorization): {
    readonly domain: {
        readonly name: "USD Coin";
        readonly version: "2";
        readonly chainId: 43114;
        readonly verifyingContract: `0x${string}`;
    };
    readonly types: {
        readonly TransferWithAuthorization: readonly [{
            readonly name: "from";
            readonly type: "address";
        }, {
            readonly name: "to";
            readonly type: "address";
        }, {
            readonly name: "value";
            readonly type: "uint256";
        }, {
            readonly name: "validAfter";
            readonly type: "uint256";
        }, {
            readonly name: "validBefore";
            readonly type: "uint256";
        }, {
            readonly name: "nonce";
            readonly type: "bytes32";
        }];
    };
    readonly primaryType: "TransferWithAuthorization";
    readonly message: {
        readonly from: `0x${string}`;
        readonly to: `0x${string}`;
        readonly value: bigint;
        readonly validAfter: 0n;
        readonly validBefore: bigint;
        readonly nonce: `0x${string}`;
    };
};
export declare function facilitatorAuthorizationDigest(authorization: FacilitatorAuthorization): Hex;
export declare function facilitatorRequirementHash(requirement: FacilitatorRequirement): string;
