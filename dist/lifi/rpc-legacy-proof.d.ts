import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeDeploymentIdentity, BridgeTool } from "./model.js";
import type { BridgeBatchCall } from "./rpc-observation.js";
/**
 * The frozen historical proofs of `operation repair-deployment`: the full code-hash deployment proof at one block and the
 * Base fee re-proof through the pinned oracle, both on the owner's archive endpoint. Live bridges never call these; they
 * stay only so the two recognized migrations can still reproduce the exact identities their audits hash.
 */
export declare function legacyDeploymentProof(chainId: BridgeChainId, origin: string, batchCall: BridgeBatchCall, tool: BridgeTool, peerChainId: BridgeChainId, token: Address, at: BridgeBlock, exactHashPin: boolean): Promise<BridgeDeploymentIdentity>;
/** The legacy Base fee proof: pinned oracle code, versions and the operator fee at the inclusion block, on the archive role. */
export declare function legacyBaseFees(chainId: BridgeChainId, call: EvmRpcCall, batchCall: BridgeBatchCall): (receipt: Readonly<Record<string, unknown>>, block: BridgeBlock, safe: BridgeBlock) => Promise<{
    gasUsedAtomic: string;
    effectiveGasPriceAtomic: string;
    executionFeeWei: string;
    l1DataFeeWei: string;
    operatorFeeWei: string;
    blobFeeWei: string;
    actualTotalFeeWei: string;
    feeEvidence: {
        receiptHash: string;
        ruleHash: string;
        baseOracle: {
            readonly oracle: Address;
            readonly from: Address;
            readonly callData: Hex;
            readonly rawReturn: Hex;
            readonly blockHash: Hex;
            readonly requireCanonical: true;
            readonly version: "1.6.0";
            readonly regime: "jovian";
            readonly scalarAtomic: string;
            readonly constantWei: string;
        } | null;
        arbitrumPosterGasAtomic: string | null;
    };
}>;
