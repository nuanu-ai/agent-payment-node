import type { SwapReceiptProof } from "./model.js";
import type { UniswapTransactionEnvelope } from "./uniswap-codec.js";
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
    };
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
export declare function validateUniswapReceipt(evidence: UniswapReceiptEvidence, envelope: UniswapTransactionEnvelope, expected: {
    readonly transactionHash: `0x${string}`;
    readonly account: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
}): SwapReceiptProof;
