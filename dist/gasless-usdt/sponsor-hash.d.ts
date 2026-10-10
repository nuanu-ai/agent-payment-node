import type { Address, Hex } from "../model.js";
import type { UsdtUserOperation } from "./userop.js";
/** Raw ERC-4337 tuple, deliberately distinct from the EntryPoint's 7702 hash substitution. */
export declare function usdtSponsorPackedOperation(op: UsdtUserOperation): {
    sender: `0x${string}`;
    nonce: bigint;
    initCode: `0x${string}`;
    callData: `0x${string}`;
    accountGasLimits: `0x${string}`;
    preVerificationGas: bigint;
    gasFees: `0x${string}`;
    paymasterAndData: `0x${string}`;
    signature: `0x${string}`;
};
/** Exact deployed historical V7 getHash, inherited by the pinned V8 runtime (113ce26). */
export declare function usdtSponsorHash(op: UsdtUserOperation): Hex;
export declare function recoverUsdtSponsor(op: UsdtUserOperation): Promise<{
    readonly sponsorHash: Hex;
    readonly signedDigest: Hex;
    readonly signature: Hex;
    readonly signer: Address;
    readonly userOperationDigest: string;
}>;
