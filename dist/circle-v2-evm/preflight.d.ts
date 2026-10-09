/** Pure finite preflight admission. Runtime must obtain all inputs from bounded canonical RPC/API reads under account locks. */
import { type Address, type Hex } from "viem";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleAttestation, type CircleSourceProof } from "./protocol.js";
export interface CircleContractSnapshot {
    readonly address: string;
    readonly proxyCodeHash: string;
    readonly implementation: string;
    readonly implementationCodeHash: string | null;
}
export interface CircleDeploymentSnapshot {
    readonly chainId: 42161 | CircleDestinationChain;
    readonly domain: number;
    readonly blockHash: Hex;
    readonly blockNumberAtomic: string;
    readonly contracts: Readonly<Record<"messenger" | "transmitter" | "minter" | "token", CircleContractSnapshot>>;
    readonly remoteDomain: number;
    readonly remoteMessenger: Hex;
    readonly pairedToken: Address;
    readonly localMinter: Address;
    readonly localMessageTransmitter: Address;
    readonly localTokenMessenger: Address;
    readonly messageVersion: number;
    readonly messageBodyVersion: number;
    readonly tokenDecimals: number;
    readonly transmitterPaused: boolean;
    readonly minterPaused: boolean;
    readonly tokenPaused: boolean;
}
/** TokenController.sol hashes abi.encodePacked(uint32 remoteDomain,bytes32 remoteToken), never abi.encode. */
export declare function circleTokenPairKey(remoteDomain: number, remoteToken: Address): Hex;
export declare function verifyCircleDeployments(source: CircleDeploymentSnapshot, destination: CircleDeploymentSnapshot): string;
export interface CircleFeeQuote {
    readonly schemaVersion: "apn.circle-fast-fee.v1";
    readonly sourceDomain: 3;
    readonly destinationDomain: 16 | 11 | 15;
    readonly minimumFeeBps: string;
    readonly quotedFeeAtomic: string;
    readonly amountAtomic: "40100";
    readonly maxFeeAtomic: "100";
    readonly minMintAtomic: "40000";
    readonly fetchedAtMs: number;
    readonly expiresAtMs: number;
    readonly responseHash: string;
    readonly integrityHash: string;
}
/** Ceil exact rational basis points. JSON floating values are accepted only as finite ordinary decimal numbers. */
export declare function quoteCircleFastFee(chain: CircleDestinationChain, value: unknown, fetchedAtMs: number, nowMs: number): CircleFeeQuote;
export declare function assertCircleFeeQuote(quote: CircleFeeQuote, chain: CircleDestinationChain, nowMs: number): void;
export interface CircleAccountPreflight {
    readonly chainId: number;
    readonly address: Address;
    readonly nativeBalanceAtomic: string;
    readonly usdcBalanceAtomic: string;
    readonly allowanceAtomic: string;
    readonly latestNonceAtomic: string;
    readonly pendingNonceAtomic: string;
}
export declare function verifyCircleSourceAccount(account: CircleAccountPreflight): {
    readonly approvalRequired: boolean;
    readonly nonceAtomic: string;
};
export declare function verifyCircleDestinationAccount(account: CircleAccountPreflight, chain: CircleDestinationChain): string;
export interface CircleGasEnvelope {
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly valueAtomic: "0";
    readonly nonceAtomic: string;
}
export declare function verifyCircleGasEnvelope(envelope: CircleGasEnvelope, chain: 42161 | CircleDestinationChain, previousSourceFeeAtomic?: string): string;
/** An expired attestation requires an explicit read-only API refresh for this burn, never another source effect. */
export declare function verifyCircleMintPreflight(source: CircleSourceProof, attested: CircleAttestation, input: {
    readonly destinationBlockAtomic: string;
    readonly usedNonceAtomic: string;
    readonly attesterConfigurationHash: string;
    readonly transactionSimulationResult: Hex;
    readonly previousNonce?: Hex;
}): void;
/** Finalization is independent of the issuer's fast attestation threshold. */
export declare function verifyCircleClosureFinality(source: CircleSourceProof, finalizedSource: CircleSourceProof): void;
