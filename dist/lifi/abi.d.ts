import type { Address, Hex } from "../model.js";
export declare const ACROSS_SELECTOR: Hex;
export declare const STARGATE_SELECTOR: Hex;
export declare const FEE_FORWARDER_SELECTOR: Hex;
export declare const FEE_FORWARDER_NATIVE_SELECTOR: Hex;
export declare const FEE_FORWARDER: Address;
export declare const FEE_RECIPIENT: Address;
export declare const LAYER_ZERO_ENDPOINT: `0x${string}`;
export declare const acrossBridgeAbi: readonly [{
    readonly name: "swapAndStartBridgeTokensViaAcrossV4";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "transactionId";
        }, {
            readonly type: "string";
            readonly name: "bridge";
        }, {
            readonly type: "string";
            readonly name: "integrator";
        }, {
            readonly type: "address";
            readonly name: "referrer";
        }, {
            readonly type: "address";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "minAmount";
        }, {
            readonly type: "uint256";
            readonly name: "destinationChainId";
        }, {
            readonly type: "bool";
            readonly name: "hasSourceSwaps";
        }, {
            readonly type: "bool";
            readonly name: "hasDestinationCall";
        }];
        readonly name: "bridgeData";
    }, {
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "callTo";
        }, {
            readonly type: "address";
            readonly name: "approveTo";
        }, {
            readonly type: "address";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "address";
            readonly name: "receivingAssetId";
        }, {
            readonly type: "uint256";
            readonly name: "fromAmount";
        }, {
            readonly type: "bytes";
            readonly name: "callData";
        }, {
            readonly type: "bool";
            readonly name: "requiresDeposit";
        }];
        readonly name: "swapData";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "receiverAddress";
        }, {
            readonly type: "bytes32";
            readonly name: "refundAddress";
        }, {
            readonly type: "bytes32";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "receivingAssetId";
        }, {
            readonly type: "uint256";
            readonly name: "outputAmount";
        }, {
            readonly type: "uint128";
            readonly name: "outputAmountMultiplier";
        }, {
            readonly type: "bytes32";
            readonly name: "exclusiveRelayer";
        }, {
            readonly type: "uint32";
            readonly name: "quoteTimestamp";
        }, {
            readonly type: "uint32";
            readonly name: "fillDeadline";
        }, {
            readonly type: "uint32";
            readonly name: "exclusivityParameter";
        }, {
            readonly type: "bytes";
            readonly name: "message";
        }];
        readonly name: "acrossData";
    }];
    readonly outputs: readonly [];
}];
export declare const stargateBridgeAbi: readonly [{
    readonly name: "swapAndStartBridgeTokensViaStargate";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "transactionId";
        }, {
            readonly type: "string";
            readonly name: "bridge";
        }, {
            readonly type: "string";
            readonly name: "integrator";
        }, {
            readonly type: "address";
            readonly name: "referrer";
        }, {
            readonly type: "address";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "minAmount";
        }, {
            readonly type: "uint256";
            readonly name: "destinationChainId";
        }, {
            readonly type: "bool";
            readonly name: "hasSourceSwaps";
        }, {
            readonly type: "bool";
            readonly name: "hasDestinationCall";
        }];
        readonly name: "bridgeData";
    }, {
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "callTo";
        }, {
            readonly type: "address";
            readonly name: "approveTo";
        }, {
            readonly type: "address";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "address";
            readonly name: "receivingAssetId";
        }, {
            readonly type: "uint256";
            readonly name: "fromAmount";
        }, {
            readonly type: "bytes";
            readonly name: "callData";
        }, {
            readonly type: "bool";
            readonly name: "requiresDeposit";
        }];
        readonly name: "swapData";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "uint16";
            readonly name: "assetId";
        }, {
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
            readonly name: "sendParams";
        }, {
            readonly type: "tuple";
            readonly components: readonly [{
                readonly type: "uint256";
                readonly name: "nativeFee";
            }, {
                readonly type: "uint256";
                readonly name: "lzTokenFee";
            }];
            readonly name: "fee";
        }, {
            readonly type: "address";
            readonly name: "refundAddress";
        }];
        readonly name: "stargateData";
    }];
    readonly outputs: readonly [];
}];
export declare const feeForwarderAbi: readonly [{
    readonly name: "forwardERC20Fees";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "recipient";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly name: "distributions";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "forwardNativeFees";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "recipient";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly name: "distributions";
    }];
    readonly outputs: readonly [];
}];
export declare const bridgeEventsAbi: readonly [{
    readonly name: "LiFiTransferStarted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "transactionId";
        }, {
            readonly type: "string";
            readonly name: "bridge";
        }, {
            readonly type: "string";
            readonly name: "integrator";
        }, {
            readonly type: "address";
            readonly name: "referrer";
        }, {
            readonly type: "address";
            readonly name: "sendingAssetId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "minAmount";
        }, {
            readonly type: "uint256";
            readonly name: "destinationChainId";
        }, {
            readonly type: "bool";
            readonly name: "hasSourceSwaps";
        }, {
            readonly type: "bool";
            readonly name: "hasDestinationCall";
        }];
        readonly name: "bridgeData";
    }];
}, {
    readonly name: "FeesForwarded";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
        readonly indexed: true;
    }, {
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "recipient";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly name: "distributions";
    }];
}, {
    readonly name: "FundsDeposited";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "inputToken";
    }, {
        readonly type: "bytes32";
        readonly name: "outputToken";
    }, {
        readonly type: "uint256";
        readonly name: "inputAmount";
    }, {
        readonly type: "uint256";
        readonly name: "outputAmount";
    }, {
        readonly type: "uint256";
        readonly name: "destinationChainId";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "depositId";
        readonly indexed: true;
    }, {
        readonly type: "uint32";
        readonly name: "quoteTimestamp";
    }, {
        readonly type: "uint32";
        readonly name: "fillDeadline";
    }, {
        readonly type: "uint32";
        readonly name: "exclusivityDeadline";
    }, {
        readonly type: "bytes32";
        readonly name: "depositor";
        readonly indexed: true;
    }, {
        readonly type: "bytes32";
        readonly name: "recipient";
    }, {
        readonly type: "bytes32";
        readonly name: "exclusiveRelayer";
    }, {
        readonly type: "bytes";
        readonly name: "message";
    }];
}, {
    readonly name: "FilledRelay";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "inputToken";
    }, {
        readonly type: "bytes32";
        readonly name: "outputToken";
    }, {
        readonly type: "uint256";
        readonly name: "inputAmount";
    }, {
        readonly type: "uint256";
        readonly name: "outputAmount";
    }, {
        readonly type: "uint256";
        readonly name: "repaymentChainId";
    }, {
        readonly type: "uint256";
        readonly name: "originChainId";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "depositId";
        readonly indexed: true;
    }, {
        readonly type: "uint32";
        readonly name: "fillDeadline";
    }, {
        readonly type: "uint32";
        readonly name: "exclusivityDeadline";
    }, {
        readonly type: "bytes32";
        readonly name: "exclusiveRelayer";
    }, {
        readonly type: "bytes32";
        readonly name: "relayer";
        readonly indexed: true;
    }, {
        readonly type: "bytes32";
        readonly name: "depositor";
    }, {
        readonly type: "bytes32";
        readonly name: "recipient";
    }, {
        readonly type: "bytes32";
        readonly name: "messageHash";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "bytes32";
            readonly name: "updatedRecipient";
        }, {
            readonly type: "bytes32";
            readonly name: "updatedMessageHash";
        }, {
            readonly type: "uint256";
            readonly name: "updatedOutputAmount";
        }, {
            readonly type: "uint8";
            readonly name: "fillType";
        }];
        readonly name: "relayExecutionInfo";
    }];
}, {
    readonly name: "OFTSent";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "guid";
        readonly indexed: true;
    }, {
        readonly type: "uint32";
        readonly name: "dstEid";
    }, {
        readonly type: "address";
        readonly name: "fromAddress";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amountSentLD";
    }, {
        readonly type: "uint256";
        readonly name: "amountReceivedLD";
    }];
}, {
    readonly name: "OFTReceived";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "guid";
        readonly indexed: true;
    }, {
        readonly type: "uint32";
        readonly name: "srcEid";
    }, {
        readonly type: "address";
        readonly name: "toAddress";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amountReceivedLD";
    }];
}, {
    readonly name: "UnreceivedTokenCached";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "guid";
    }, {
        readonly type: "uint8";
        readonly name: "index";
    }, {
        readonly type: "uint32";
        readonly name: "srcEid";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "uint256";
        readonly name: "amountLD";
    }, {
        readonly type: "bytes";
        readonly name: "composeMsg";
    }];
}, {
    readonly name: "Transfer";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "from";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "to";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "value";
    }];
}, {
    readonly name: "Deposit";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "dst";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "wad";
    }];
}, {
    readonly name: "Withdrawal";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "src";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "wad";
    }];
}];
export declare const EVENT_TOPICS: {
    readonly lifiTransferStarted: "0xcba69f43792f9f399347222505213b55af8e0b0b54b893085c2e27ecbe1644f1";
    readonly feesForwarded: "0x3a7029951ba36c1af37954df919ce2f9a95c3f5c2c2e872d5e7fd47c61a6df26";
    readonly fundsDeposited: "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3";
    readonly filledRelay: "0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208";
    readonly oftSent: "0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a";
    readonly oftReceived: "0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c";
    readonly unreceivedTokenCached: "0x007c17198cd078035dc663f9a0961f84cb6265411d0b4c793f96d432f6af4b55";
    readonly transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    readonly wrappedDeposit: "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
    readonly wrappedWithdrawal: "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
};
export declare const deploymentAbi: readonly [{
    readonly name: "facetAddress";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes4";
        readonly name: "selector";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "isContractSelectorWhitelisted";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "target";
    }, {
        readonly type: "bytes4";
        readonly name: "selector";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "owner";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly name: "implementation";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "SPOKEPOOL";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "WRAPPED_NATIVE";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
}, {
    readonly name: "depositQuoteTimeBuffer";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly name: "fillDeadlineBuffer";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly name: "tokenMessaging";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "stargateImpls";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint16";
        readonly name: "assetId";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "assetIds";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "router";
    }];
    readonly outputs: readonly [{
        readonly type: "uint16";
    }];
}, {
    readonly name: "peers";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint32";
        readonly name: "eid";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
}, {
    readonly name: "token";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "localEid";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint32";
    }];
}, {
    readonly name: "endpoint";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "sharedDecimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly name: "getAddressConfig";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
        readonly name: "feeLib";
    }, {
        readonly type: "address";
        readonly name: "planner";
    }, {
        readonly type: "address";
        readonly name: "treasurer";
    }, {
        readonly type: "address";
        readonly name: "tokenMessaging";
    }, {
        readonly type: "address";
        readonly name: "creditMessaging";
    }, {
        readonly type: "address";
        readonly name: "lzToken";
    }];
}, {
    readonly name: "basisPointsRate";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "maximumFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "deprecated";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "internalCallers";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "caller";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "coreAddress";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "weth";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "whitelist";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "caller";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "EXECUTOR";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}];
