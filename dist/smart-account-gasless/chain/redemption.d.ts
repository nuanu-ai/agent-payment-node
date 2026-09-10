import type { Address, Hex } from "../../model.js";
import type { SmartAccountGaslessMaterialValidatorPort } from "../ports.js";
import type { SmartAccountGaslessIntent, SmartAccountGaslessMaterialDescriptor, SmartAccountGaslessPayload } from "../model.js";
export interface DecodedSmartAccountCaveat {
    readonly enforcer: Address;
    readonly terms: Hex;
    readonly args: Hex;
}
export interface DecodedSmartAccountDelegation {
    readonly delegate: Address;
    readonly delegator: Address;
    readonly authority: Hex;
    readonly caveats: readonly DecodedSmartAccountCaveat[];
    readonly salt: bigint;
    readonly signature: Hex;
}
export interface VerifiedSmartAccountRedemption {
    readonly calldata: Hex;
    readonly permissionContext: Hex;
    readonly rootContext: Hex;
    readonly child: DecodedSmartAccountDelegation;
    readonly root: DecodedSmartAccountDelegation;
    readonly childDelegationHash: Hex;
    readonly executionCallData: Hex;
    readonly paymentPayload: SmartAccountGaslessPayload;
}
/** Decode canonical one-context redemption and delegate all cryptographic caveat validation to the neutral port. */
export declare function verifySmartAccountRedemption(calldataInput: Hex, operationId: string, fingerprint: string, intent: SmartAccountGaslessIntent, material: SmartAccountGaslessMaterialDescriptor, validator: SmartAccountGaslessMaterialValidatorPort): Promise<VerifiedSmartAccountRedemption>;
