import type { EvmChainId } from "../evm-asset.js";
import type { Hex } from "../model.js";
import type { BridgeEnvelope } from "./model.js";
export declare function verifyRpcTransaction(raw: Record<string, unknown>, chainId: EvmChainId, hash: Hex, expected?: BridgeEnvelope): Promise<{
    from: `0x${string}`;
    to: `0x${string}`;
    nonceAtomic: string;
    valueAtomic: string;
    dataHash: string;
    gasLimitAtomic: string;
    maxFeePerGasAtomic: string;
    maxPriorityFeePerGasAtomic: string;
}>;
