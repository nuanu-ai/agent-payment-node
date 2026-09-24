import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { type UsdtBoundOperation } from "./bound-operation.js";
import { type UsdtUserOperation } from "./userop.js";
export interface UsdtSigningIdentity {
    readonly profile: string;
    readonly profileHash: string;
    readonly operationId: string;
    readonly bindingHash: string;
}
export interface SignedUsdtUserOperation {
    readonly schemaVersion: "apn.gasless-usdt-local-signature.v1";
    readonly operationId: string;
    readonly profileHash: string;
    readonly bindingHash: string;
    readonly userOperation: UsdtUserOperation;
    readonly userOperationHash: Hex;
    readonly materialHash: string;
}
/** Local custody only. The signed wire is returned to the caller; no journal or transport is touched. */
export declare class LocalUsdtSigningService {
    private readonly state;
    private readonly now;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort, now?: () => Date);
    sign(value: UsdtBoundOperation, expected: UsdtSigningIdentity): Promise<SignedUsdtUserOperation>;
}
/** Independent local check for a returned wire. The prepared calldata, fees and paymaster bytes are immutable. */
export declare function verifySignedUsdtOperation(boundValue: UsdtBoundOperation, wire: UsdtUserOperation): Promise<Hex>;
