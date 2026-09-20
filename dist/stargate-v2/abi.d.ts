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
/**
 * Pinned to IStargate.sol and StargateBase.sol at
 * stargate-protocol/stargate-v2@ce598b8d16472cd76ee47d30b8a40bc5c1b667bb.
 */
export declare const STARGATE_SEND_ABI: readonly [{
    readonly type: "function";
    readonly name: "sendToken";
    readonly stateMutability: "payable";
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
        readonly name: "_fee";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "nativeFee";
            readonly type: "uint256";
        }, {
            readonly name: "lzTokenFee";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "_refundAddress";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "msgReceipt";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "guid";
            readonly type: "bytes32";
        }, {
            readonly name: "nonce";
            readonly type: "uint64";
        }, {
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
    }, {
        readonly name: "oftReceipt";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "amountSentLD";
            readonly type: "uint256";
        }, {
            readonly name: "amountReceivedLD";
            readonly type: "uint256";
        }];
    }, {
        readonly name: "ticket";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "ticketId";
            readonly type: "uint72";
        }, {
            readonly name: "passengerBytes";
            readonly type: "bytes";
        }];
    }];
}, {
    readonly type: "function";
    readonly name: "token";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly type: "function";
    readonly name: "localEid";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly type: "function";
    readonly name: "sharedDecimals";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly type: "function";
    readonly name: "status";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly type: "function";
    readonly name: "paths";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "eid";
        readonly type: "uint32";
    }];
    readonly outputs: readonly [{
        readonly type: "uint64";
    }];
}, {
    readonly type: "function";
    readonly name: "stargateType";
    readonly stateMutability: "pure";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly type: "event";
    readonly name: "OFTSent";
    readonly inputs: readonly [{
        readonly name: "guid";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "dstEid";
        readonly type: "uint32";
        readonly indexed: false;
    }, {
        readonly name: "fromAddress";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amountSentLD";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "amountReceivedLD";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "OFTReceived";
    readonly inputs: readonly [{
        readonly name: "guid";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "srcEid";
        readonly type: "uint32";
        readonly indexed: false;
    }, {
        readonly name: "toAddress";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amountReceivedLD";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}];
/** Minimal ERC-20 surface used by the token lane. */
export declare const STARGATE_ERC20_ABI: readonly [{
    readonly type: "function";
    readonly name: "allowance";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "address";
        readonly name: "spender";
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
        readonly name: "account";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "approve";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "spender";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}];
/** Executor DstConfig getter pinned to LayerZero-v2 Executor.sol. */
export declare const LAYERZERO_EXECUTOR_ABI: readonly [{
    readonly type: "function";
    readonly name: "dstConfig";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint32";
        readonly name: "dstEid";
    }];
    readonly outputs: readonly [{
        readonly type: "uint64";
        readonly name: "lzReceiveBaseGas";
    }, {
        readonly type: "uint16";
        readonly name: "multiplierBps";
    }, {
        readonly type: "uint128";
        readonly name: "floorMarginUSD";
    }, {
        readonly type: "uint128";
        readonly name: "nativeCap";
    }, {
        readonly type: "uint64";
        readonly name: "lzComposeBaseGas";
    }];
}];
