import type { Address, Hex } from "../model.js";
export declare const BNB_COMPOSITE: Readonly<{
    chainId: 56;
    receiver: `0x${string}`;
    spokePool: `0x${string}`;
    executor: `0x${string}`;
    flyRouter: `0x${string}`;
    core: `0x${string}`;
    weth: `0x${string}`;
    wbnb: `0x${string}`;
    selector: Hex;
    signer: `0x${string}`;
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
    readonly flyCalldata: Hex;
    readonly payloadHash: Hex;
    readonly messageHash: Hex;
}
/** Strict parser for the one reviewed LI.FI ReceiverAcrossV4 -> Executor -> Fly destination call. */
export declare function decodeBnbCompositeMessage(message: Hex, expectedTransactionId: Hex, expectedRecipient: Address): BnbCompositeCall;
/**
 * Reads `swapWithBackendSignature(bytes)` the way Fly's router does (`LibRouter.getData`) and checks only that header:
 * the Executor as recipient, WETH in, native out, the exact input amount, the compact deadline, output floor, expected
 * output and retention words, the consumer, no transfer from the router, the signature and no swap fees. The bytes
 * after the header are Fly Core's route for this one quote (pools, hops, wrapping), which Fly picks by liquidity and
 * changes from quote to quote. APN does not interpret them: the router pays the Executor only through the signed retention
 * rule and reverts unless the Executor's native balance grew by at least the signed `amountOutMin`, whatever the route did.
 * Retention only splits output above the signed expected output: the router then pays the larger of that expected output
 * and the output less `maxRetentionBps` of it, so 10000 (Fly signs it per quote; QA's quotes carried it) leaves Fly everything
 * above expected and never touches the floor. Above 10000 the router's checked subtraction reverts every swap that beats expected.
 */
export declare function decodeFlyProgram(calldata: Hex, _expectedRecipient: Address, expectedAmount: bigint): Omit<BnbCompositeCall, "kind" | "transactionId" | "finalReceiver" | "inputAmountAtomic" | "messageHash" | "flyCalldata">;
/**
 * Rebuild Fly's exact no-fee EIP-712 header authorization; the router checks the same digest against its signer list
 * and refuses the signature forms it would reject. Prepare runs this; a stored record is only re-decoded.
 */
export declare function verifyFlyHeaderSignature(call: Pick<BnbCompositeCall, "deadlineAtomic" | "minimumOutputAtomic" | "expectedOutputAtomic" | "maximumRetentionBps" | "consumerId" | "signature">, authorizedSigner: Address): Promise<Readonly<{
    digest: Hex;
    signer: Address;
}>>;
