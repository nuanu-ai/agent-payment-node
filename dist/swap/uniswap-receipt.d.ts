import type { SwapReceiptProof } from "./model.js";
import type { UniswapTransactionEnvelope } from "./uniswap-v3/envelope.js";
export interface UniswapReceiptEvidence {
    readonly transactionHash: `0x${string}`;
    readonly transaction: {
        readonly hash: `0x${string}`;
        readonly from: string;
        readonly to: string;
        readonly input: `0x${string}`;
        readonly value: string;
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
    };
    readonly receipt: {
        readonly transactionHash: `0x${string}`;
        readonly status: "0x1";
        readonly blockNumber: string;
        readonly blockHash: `0x${string}`;
        readonly logs: readonly {
            readonly address: string;
            readonly topics: readonly `0x${string}`[];
            readonly data: `0x${string}`;
        }[];
    } & UniswapReceiptFee;
    readonly beforeNative: string;
    readonly afterNative: string;
    readonly beforeOutput: string;
    readonly afterOutput: string;
    readonly finalizedHead: {
        readonly number: string;
        readonly hash: `0x${string}`;
    };
    readonly observedAt: string;
}
/** Ethereum charges a type-0/2 transaction gasUsed x effectiveGasPrice; both come from the receipt or neither is kept. */
export type UniswapReceiptFee = {
    readonly gasUsed?: string;
    readonly effectiveGasPrice?: string;
};
export declare function uniswapReceiptFee(receipt: Readonly<Record<string, unknown>>): UniswapReceiptFee;
export declare function uniswapFeeAtomic(fee: UniswapReceiptFee): bigint | null;
export declare function validateUniswapReceipt(evidence: UniswapReceiptEvidence, envelope: UniswapTransactionEnvelope, expected: {
    readonly transactionHash: `0x${string}`;
    readonly account: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly outputToken: string;
}): SwapReceiptProof;
/** A pool Swap event carries several data words; only a one-word ERC-20 Transfer of the output token to the recipient counts. */
export declare function uniswapCredited(logs: readonly {
    readonly address: string;
    readonly topics: readonly string[];
    readonly data: string;
}[], outputTokenValue: string, recipient: string): bigint;
