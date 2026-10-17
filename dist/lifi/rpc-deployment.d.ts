import type { Address } from "../model.js";
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
