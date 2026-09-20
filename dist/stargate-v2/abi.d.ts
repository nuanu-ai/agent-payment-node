export declare const STARGATE_SEND_PARAM: readonly [{
    readonly type: "tuple";
    readonly components: readonly [{
        readonly type: "uint32";
        readonly name: "dstEid";
    }, {
        readonly type: "bytes32";
        readonly name: "to";
    }, {
        readonly type: "uint256";
        readonly name: "amountLD";
    }, {
        readonly type: "uint256";
        readonly name: "minAmountLD";
    }, {
        readonly type: "bytes";
        readonly name: "extraOptions";
    }, {
        readonly type: "bytes";
        readonly name: "composeMsg";
    }, {
        readonly type: "bytes";
        readonly name: "oftCmd";
    }];
}];
export declare const STARGATE_QUOTE_OFT_OUTPUT: readonly [{
    readonly type: "tuple";
    readonly components: readonly [{
        readonly type: "uint256";
        readonly name: "minAmountLD";
    }, {
        readonly type: "uint256";
        readonly name: "maxAmountLD";
    }];
    readonly name: "limit";
}, {
    readonly type: "tuple[]";
    readonly components: readonly [{
        readonly type: "int256";
        readonly name: "feeAmountLD";
    }, {
        readonly type: "string";
        readonly name: "description";
    }];
    readonly name: "oftFeeDetails";
}, {
    readonly type: "tuple";
    readonly components: readonly [{
        readonly type: "uint256";
        readonly name: "amountSentLD";
    }, {
        readonly type: "uint256";
        readonly name: "amountReceivedLD";
    }];
    readonly name: "receipt";
}];
export declare const STARGATE_QUOTE_SEND_OUTPUT: readonly [{
    readonly type: "tuple";
    readonly components: readonly [{
        readonly type: "uint256";
        readonly name: "nativeFee";
    }, {
        readonly type: "uint256";
        readonly name: "lzTokenFee";
    }];
    readonly name: "fee";
}];
export declare const STARGATE_QUOTE_ABI: readonly [{
    readonly type: "function";
    readonly name: "quoteOFT";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "_sendParam";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "dstEid";
            readonly type: "uint32";
        }, {
            readonly name: "to";
            readonly type: "bytes32";
        }, {
            readonly name: "amountLD";
            readonly type: "uint256";
        }, {
            readonly name: "minAmountLD";
            readonly type: "uint256";
        }, {
            readonly name: "extraOptions";
            readonly type: "bytes";
        }, {
            readonly name: "composeMsg";
            readonly type: "bytes";
        }, {
            readonly name: "oftCmd";
            readonly type: "bytes";
        }];
    }];
    readonly outputs: readonly [{
        readonly name: "limit";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "minAmountLD";
            readonly type: "uint256";
        }, {
            readonly name: "maxAmountLD";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "oftFeeDetails";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "feeAmountLD";
            readonly type: "int256";
        }, {
            readonly name: "description";
            readonly type: "string";
        }];
    }, {
        readonly name: "receipt";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "amountSentLD";
            readonly type: "uint256";
        }, {
            readonly name: "amountReceivedLD";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly type: "function";
    readonly name: "quoteSend";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "_sendParam";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "dstEid";
            readonly type: "uint32";
        }, {
            readonly name: "to";
            readonly type: "bytes32";
        }, {
            readonly name: "amountLD";
            readonly type: "uint256";
        }, {
            readonly name: "minAmountLD";
            readonly type: "uint256";
        }, {
            readonly name: "extraOptions";
            readonly type: "bytes";
        }, {
            readonly name: "composeMsg";
            readonly type: "bytes";
        }, {
            readonly name: "oftCmd";
            readonly type: "bytes";
        }];
    }, {
        readonly name: "_payInLzToken";
        readonly type: "bool";
    }];
    readonly outputs: readonly [{
        readonly name: "fee";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "nativeFee";
            readonly type: "uint256";
        }, {
            readonly name: "lzTokenFee";
            readonly type: "uint256";
        }];
    }];
}];
