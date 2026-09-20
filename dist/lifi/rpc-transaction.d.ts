import type { BridgeChainId } from "./chains.js";
import type { Hex } from "../model.js";
import type { BridgeEnvelope } from "./model.js";
/**
 * Some EVM RPC providers encode transaction signature scalars without a leading zero nibble.
 * This tolerance is intentionally local to transaction r/s; generic DATA remains byte-exact.
 */
export declare function evmTransactionSignatureScalar(value: unknown): Hex;
export declare function verifyRpcTransaction(raw: Record<string, unknown>, chainId: BridgeChainId, hash: Hex, expected?: BridgeEnvelope): Promise<{
    from: `0x${string}`;
    to: `0x${string}`;
    nonceAtomic: string;
    valueAtomic: string;
    dataHash: string;
    gasLimitAtomic: string;
    maxFeePerGasAtomic: string;
    maxPriorityFeePerGasAtomic: string;
}>;
