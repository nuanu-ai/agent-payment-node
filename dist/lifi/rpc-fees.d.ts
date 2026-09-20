import type { BridgeChainId } from "./chains.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Hex } from "../model.js";
import type { BridgeBlock } from "./model.js";
export declare const BRIDGE_FEE_RULE_HASH: string;
export declare const BASE_FEE_CONTRACT: {
    readonly code: readonly [{
        readonly address: `0x${string}`;
        readonly codeHash: Hex;
    }, {
        readonly address: `0x${string}`;
        readonly codeHash: Hex;
    }];
    readonly reads: readonly [{
        readonly kind: "storage";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    }, {
        readonly kind: "storage";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    }, {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: `0x${string}`;
    }, {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: `0x${string}`;
    }, {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    }, {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    }];
};
export declare function bridgeActualFees(chainId: BridgeChainId, receipt: Readonly<Record<string, unknown>>, block: BridgeBlock, call: EvmRpcCall): Promise<{
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
            readonly oracle: import("../model.js").Address;
            readonly from: import("../model.js").Address;
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
export declare function verifyBaseFeeDeployment(call: EvmRpcCall, block: BridgeBlock): Promise<void>;
