import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
export interface StargateV2QuoteRequest {
    readonly sourceChainId: number;
    readonly destinationChainId: number;
    readonly sourceToken: Address | "native";
    readonly destinationToken: Address | "native";
    readonly recipient: Address;
    readonly amountAtomic: string;
    /** Canonical LayerZero Type-3 options. Empty for ordinary transfers. */
    readonly extraOptions?: Hex;
}
export interface StargateV2QuoteEvidence {
    readonly schemaVersion: "apn.stargate-v2-direct-quote.v1";
    readonly executionAdmitted: false;
    readonly route: {
        readonly sourceChainId: number;
        readonly sourceEid: number;
        readonly sourceToken: Address;
        readonly sourcePool: Address;
        readonly destinationChainId: number;
        readonly destinationEid: number;
        readonly destinationToken: Address;
        readonly destinationPool: Address;
        readonly asset: string;
    };
    readonly quote: {
        readonly requestedAmountAtomic: string;
        readonly minimumTransferAtomic: string;
        readonly maximumTransferAtomic: string;
        readonly amountSentAtomic: string;
        readonly minimumOutputAtomic: string;
        readonly protocolFees: readonly {
            readonly amountAtomic: string;
            readonly description: string;
        }[];
        readonly nativeMessageFeeAtomic: string;
        readonly lzTokenFeeAtomic: "0";
    };
    readonly recipient: Address;
    readonly block: {
        readonly numberAtomic: string;
        readonly hash: Hex;
    };
    readonly requestHash: string;
    readonly quoteHash: string;
}
export type StargateReadBatch = (calls: readonly {
    readonly method: string;
    readonly params: readonly unknown[];
}[]) => Promise<readonly unknown[]>;
export declare function quoteStargateV2Direct(request: StargateV2QuoteRequest, call: EvmRpcCall, batch?: StargateReadBatch): Promise<StargateV2QuoteEvidence>;
