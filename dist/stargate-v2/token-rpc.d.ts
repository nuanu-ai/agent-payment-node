import { encodeFunctionData, type Hex } from "viem";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address } from "../model.js";
import type { StargateV2QuoteEvidence } from "./quote.js";
import type { StargateTokenConfirmedReceipt, StargateTokenDestinationEvidence, StargateTokenEnvelope, StargateTokenOperation, StargateTokenSourceReceipt } from "./token-model.js";
export declare function rpcEnvelope(envelope: StargateTokenEnvelope): {
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    gas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
};
export declare function sourceReceipt(op: StargateTokenOperation, receipt: StargateTokenConfirmedReceipt): StargateTokenSourceReceipt;
export declare function validateDestination(op: StargateTokenOperation, source: StargateTokenSourceReceipt, e: StargateTokenDestinationEvidence): void;
export declare function readExecutorCap(call: EvmRpcCall, tag: string): Promise<bigint>;
export declare function requoteSend(call: EvmRpcCall, sendParam: Parameters<typeof encodeFunctionData>[0] extends never ? never : any, tag: string): Promise<bigint>;
export declare function readPoolConfig(call: EvmRpcCall, chain: number, pool: Address, token: Address, eid: number, tag: string): Promise<{
    poolCodeHash: `0x${string}`;
    tokenCodeHash: `0x${string}`;
}>;
export declare function readAllowance(call: EvmRpcCall, owner: Address, tag: string): Promise<bigint>;
export declare function readTokenBalance(call: EvmRpcCall, token: Address, owner: Address, tag: string): Promise<bigint>;
export declare function assertLane(q: StargateV2QuoteEvidence): void;
export declare function verifySignedEnvelope(raw: Hex, owner: Address, e: StargateTokenEnvelope): Promise<undefined>;
