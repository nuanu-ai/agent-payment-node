import type { PermissionContext } from "@metamask/smart-accounts-kit";
import type { Address, Hex } from "../model.js";
export interface Erc7710PaymentRequirements {
    readonly scheme: string;
    readonly network: string;
    readonly asset: Address;
    readonly amount: string;
    readonly payTo: Address;
    readonly maxTimeoutSeconds: number;
    readonly extra: Readonly<Record<string, unknown>>;
}
/** A seller-neutral description of one exact ERC-7710 child delegation. */
export interface Erc7710MaterialIntent {
    readonly operationId: string;
    readonly fingerprint: string;
    readonly chainId: 8453;
    readonly token: Address;
    readonly amountAtomic: string;
    readonly payee: Address;
    readonly ownerAddress: Address;
    readonly sessionAddress: Address;
    readonly delegationManager: Address;
    readonly afterUnix: number;
    readonly beforeUnix: number;
    readonly facilitatorAddresses: readonly Address[];
    readonly salt: Hex;
    readonly requirements: Erc7710PaymentRequirements;
    readonly rootContext: Hex;
}
/** Private custody values are supplied only at the signing boundary. */
export interface Erc7710Custody {
    readonly sessionPrivateKey: Hex;
    readonly rootContext: PermissionContext;
}
export interface Erc7710WirePayload {
    readonly [key: string]: unknown;
    readonly delegationManager: Address;
    readonly delegator: Address;
    readonly permissionContext: Hex;
}
export interface Erc7710PaymentPayload {
    readonly x402Version: 2;
    readonly accepted: Erc7710PaymentRequirements;
    readonly payload: Erc7710WirePayload;
}
export interface Erc7710ValidatedMaterial {
    readonly encodedRoot: Hex;
    readonly encodedChild: Hex;
    readonly permissionContext: Hex;
    readonly rootDelegationHash: Hex;
    readonly childDelegationHash: Hex;
}
