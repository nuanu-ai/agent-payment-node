/** Pure funding-v2 metadata only. No custody, reservation, network, CLI or execution authority. */
import { type Address } from "viem";
import { type CircleDestinationChain } from "./catalog.js";
export interface CircleFundingParameters {
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly maxFeeAtomic: string;
    readonly minMintAtomic: string;
}
export interface CircleFundingBindingV2 extends CircleFundingParameters {
    readonly schemaVersion: "apn.circle-funding-binding.v2";
    readonly sourceProfile: string;
    readonly sourceChain: 42161;
    readonly sourceDomain: 3;
    readonly sourceOwner: Address;
    readonly sourceToken: Address;
    readonly decimals: 6;
    readonly destinationChain: CircleDestinationChain;
    readonly destinationDomain: 16 | 11 | 15;
    readonly destinationToken: Address;
    readonly destinationProfile: string;
    readonly gasPayer: Address;
    readonly mechanism: Readonly<{
        provider: "circle-cctp-v2";
        reference: string;
    }>;
    readonly bindingHash: string;
}
export interface CircleFundingFeeV2 {
    readonly schemaVersion: "apn.circle-fast-fee.v2";
    readonly bindingHash: string;
    readonly minimumFeeBps: string;
    readonly quotedFeeAtomic: string;
    readonly fetchedAtMs: number;
    readonly expiresAtMs: number;
    readonly responseHash: string;
    readonly integrityHash: string;
}
/** All absent means the unchanged legacy input. A partial or unknown field set cannot select v2. */
export declare function deriveCircleFundingParameters(value: unknown): CircleFundingParameters | null;
/** Who signs: the source profile and its custody wallet, and the destination gas profile and its custody wallet. */
export interface CircleFundingIdentity {
    readonly sourceProfile: string;
    readonly sourceOwner: Address;
    readonly destinationProfile: string;
    readonly gasPayer: Address;
}
/** Protocol fields come from the route table; identity and economics are the caller's explicit, already-resolved inputs. */
export declare function circleFundingBinding(chain: CircleDestinationChain, identity: CircleFundingIdentity, value: unknown): CircleFundingBindingV2;
/** The STORED binding: exact keys, its own seal, canonical parameters and identity spellings, and protocol fields equal
 * to the route table row it names (OWNR 5.2). Identity is never compared with a constant here; the operation validator
 * binds `sourceProfile/sourceOwner/destinationProfile/gasPayer` to the operation's own profiles and custody records. */
export declare function validateCircleFundingBinding(value: unknown): CircleFundingBindingV2;
export declare function quoteCircleFundingFee(bindingValue: unknown, response: unknown, fetchedAtMs: number, nowMs: number): CircleFundingFeeV2;
export declare function assertCircleFundingFee(bindingValue: unknown, value: unknown, nowMs: number): CircleFundingFeeV2;
