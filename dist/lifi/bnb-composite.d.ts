import type { Address, Hex } from "../model.js";
export declare const BNB_COMPOSITE: Readonly<{
    chainId: 56;
    receiver: `0x${string}`;
    executor: `0x${string}`;
    flyRouter: `0x${string}`;
    core: `0x${string}`;
    weth: `0x${string}`;
    wbnb: `0x${string}`;
    vault: `0x${string}`;
    poolId: Hex;
    poolTokens: readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
    selector: Hex;
    balancerSelector: Hex;
    signer: `0x${string}`;
    commandDescriptors: readonly ["010000015a01650000", "00002001a301d0013f", "05000001d001d60000", "06002001d601d90000", "03000001d901e00000"];
}>;
export interface BnbCompositeCall {
    readonly kind: "across-fly-bnb";
    readonly transactionId: Hex;
    readonly finalReceiver: Address;
    readonly inputAmountAtomic: string;
    readonly expectedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadlineAtomic: string;
    readonly maximumRetentionBps: number;
    readonly consumerId: Hex;
    readonly signature: Hex;
    readonly payloadHash: Hex;
    readonly messageHash: Hex;
}
/** Strict parser for the one reviewed LI.FI ReceiverAcrossV4 -> Executor -> Fly program. */
export declare function decodeBnbCompositeMessage(message: Hex, expectedTransactionId: Hex, expectedRecipient: Address): BnbCompositeCall;
export declare function decodeFlyProgram(calldata: Hex, _expectedRecipient: Address, expectedAmount: bigint): Omit<BnbCompositeCall, "kind" | "transactionId" | "finalReceiver" | "inputAmountAtomic" | "messageHash">;
/** Rebuild Fly's exact no-fee EIP-712 header authorization; command integrity remains the parser's responsibility. */
export declare function verifyFlyHeaderSignature(call: Pick<BnbCompositeCall, "deadlineAtomic" | "minimumOutputAtomic" | "expectedOutputAtomic" | "maximumRetentionBps" | "consumerId" | "signature">, authorizedSigner: Address): Promise<Readonly<{
    digest: Hex;
    signer: Address;
}>>;
export declare const bnbPoolReadData: Readonly<{
    registration: `0x${string}`;
    tokens: `0x${string}`;
}>;
/** Fail-closed semantic decoding avoids pinning mutable balances while pinning the pool registration and token order. */
export declare function verifyBnbPoolConfiguration(registrationRaw: Hex, tokensRaw: Hex): Readonly<{
    pool: Address;
    specialization: number;
    tokens: readonly Address[];
    lastChangeBlockAtomic: string;
}>;
