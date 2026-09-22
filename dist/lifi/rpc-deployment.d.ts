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
export declare const BASE_ECOTONE_EIP6780_TIMESTAMP = 1710374401n;
export declare function deploymentMulticallEligible(data: Hex): boolean;
export type DeploymentReadRow = {
    readonly kind: "call" | "storage";
    readonly address: Address;
    readonly data: Hex;
    readonly expected: Hex;
};
export declare function deploymentAggregateItem(rows: readonly DeploymentReadRow[], tag: unknown): Omit<RpcBatchReadItem, "batchAttempt">;
export declare const LINEA_TRACE_PROBE_TRANSACTION: Hex;
export declare const MONAD_TRACE_PROBE_TRANSACTION: Hex;
