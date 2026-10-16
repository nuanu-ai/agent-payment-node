import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeTool } from "./model.js";
import type { RpcBatchReadItem } from "./rpc-session.js";
import type { Address, Hex } from "../model.js";
export declare const ERC20_READ: readonly [{
    readonly type: "function";
    readonly name: "allowance";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }, {
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "balanceOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}];
export declare const GAS_ORACLE: Address;
export declare const L1_BLOCK: Address;
export declare const GAS_ORACLE_ABI: readonly [{
    readonly type: "function";
    readonly name: "getL1FeeUpperBound";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "size";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "getOperatorFee";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "gas";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}];
export declare function deploymentMulticallEligible(data: Hex): boolean;
export type DeploymentReadRow = {
    readonly kind: "call" | "storage";
    readonly address: Address;
    readonly data: Hex;
    readonly expected: Hex;
};
export declare function deploymentAggregateItem(rows: readonly DeploymentReadRow[], tag: unknown): Omit<RpcBatchReadItem, "batchAttempt">;
type PlannedRead = Omit<RpcBatchReadItem, "batchAttempt">;
/**
 * The legacy full historical deployment proof at one block, on the archive role. Live bridges use the light check in
 * deployment-check.ts; only the frozen historical migration proofs (`operation repair-deployment`) still replay this plan.
 */
export declare function bridgeDeploymentReadPlan(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address, at: BridgeBlock, exactHashPin: boolean): {
    contract: import("./model.js").BridgeDeploymentContract;
    feeContract: {
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
    } | {
        code: never[];
        reads: never[];
    };
    verificationCodeRows: {
        readonly address: Address;
        readonly codeHash: Hex;
    }[];
    readRows: {
        readonly kind: "call" | "storage";
        readonly address: Address;
        readonly data: Hex;
        readonly expected: Hex;
    }[];
    directRows: {
        readonly kind: "call" | "storage";
        readonly address: Address;
        readonly data: Hex;
        readonly expected: Hex;
    }[];
    aggregateGroups: {
        readonly kind: "call" | "storage";
        readonly address: Address;
        readonly data: Hex;
        readonly expected: Hex;
    }[][];
    items: PlannedRead[];
};
/** The legacy Base pinned fee proof at the included block's canonical hash, kept only for the frozen migration proofs. */
export declare function basePinnedFeeReadPlan(gas: bigint, block: BridgeBlock, safe: BridgeBlock): {
    codeRows: {
        readonly address: `0x${string}`;
        readonly codeHash: Hex;
    }[];
    directRows: ({
        readonly kind: "storage";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    } | {
        readonly kind: "storage";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: `0x${string}`;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: `0x${string}`;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    })[];
    aggregateRows: ({
        readonly kind: "storage";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    } | {
        readonly kind: "storage";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: `0x${string}`;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: `0x${string}`;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    } | {
        readonly kind: "call";
        readonly address: `0x${string}`;
        readonly data: Hex;
        readonly expected: Hex;
    })[];
    items: PlannedRead[];
};
export {};
