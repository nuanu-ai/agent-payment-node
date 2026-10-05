/** Handler ABI attested against the original pinned executable prefix, official commit ad2658ac57bbf24d33192cb0f5dac5cf423f00a8.
 * Original compiler metadata identity remains unproved. This ABI never substitutes the registry's full runtime pin. */
export declare const PERMIT2_DIRECT_PROXY_ABI: readonly [{
    readonly name: "settle";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "permitted";
            readonly type: "tuple";
            readonly components: readonly [{
                readonly type: "address";
                readonly name: "token";
            }, {
                readonly type: "uint256";
                readonly name: "amount";
            }];
        }, {
            readonly type: "uint256";
            readonly name: "nonce";
        }, {
            readonly type: "uint256";
            readonly name: "deadline";
        }];
        readonly name: "permit";
    }, {
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint256";
            readonly name: "validAfter";
        }];
        readonly name: "witness";
    }, {
        readonly type: "bytes";
        readonly name: "signature";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "settleWithPermit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "uint256";
            readonly name: "value";
        }, {
            readonly type: "uint256";
            readonly name: "deadline";
        }, {
            readonly type: "bytes32";
            readonly name: "r";
        }, {
            readonly type: "bytes32";
            readonly name: "s";
        }, {
            readonly type: "uint8";
            readonly name: "v";
        }];
        readonly name: "permit2612";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "permitted";
            readonly type: "tuple";
            readonly components: readonly [{
                readonly type: "address";
                readonly name: "token";
            }, {
                readonly type: "uint256";
                readonly name: "amount";
            }];
        }, {
            readonly type: "uint256";
            readonly name: "nonce";
        }, {
            readonly type: "uint256";
            readonly name: "deadline";
        }];
        readonly name: "permit";
    }, {
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint256";
            readonly name: "validAfter";
        }];
        readonly name: "witness";
    }, {
        readonly type: "bytes";
        readonly name: "signature";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "Settled";
    readonly type: "event";
    readonly inputs: readonly [];
}, {
    readonly name: "SettledWithPermit";
    readonly type: "event";
    readonly inputs: readonly [];
}];
