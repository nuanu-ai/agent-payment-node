import type { Hex } from "../model.js";
import type { MetaMaskGaslessUnsignedResult } from "./model.js";
import type { MetaMaskGaslessUnsignedInput } from "./ports.js";
import { type MetaMaskGaslessFailureReason } from "./reasons.js";
export declare const MM_ANY_BENEFICIARY: "0x0000000000000000000000000000000000000a11";
export declare const MM_ROOT_AUTHORITY: Hex;
export declare const MM_BATCH_MODE: Hex;
export declare const MM_ONE_CALL_TERMS: Hex;
export declare const MM_EXECUTION_ABI: readonly [{
    readonly type: "tuple[]";
    readonly components: readonly [{
        readonly name: "target";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "callData";
        readonly type: "bytes";
    }];
}];
export declare const MM_DELEGATION_TYPES: {
    readonly Caveat: readonly [{
        readonly name: "enforcer";
        readonly type: "address";
    }, {
        readonly name: "terms";
        readonly type: "bytes";
    }];
    readonly Delegation: readonly [{
        readonly name: "delegate";
        readonly type: "address";
    }, {
        readonly name: "delegator";
        readonly type: "address";
    }, {
        readonly name: "authority";
        readonly type: "bytes32";
    }, {
        readonly name: "caveats";
        readonly type: "Caveat[]";
    }, {
        readonly name: "salt";
        readonly type: "uint256";
    }];
};
export declare function mmExactBatchTerms(input: MetaMaskGaslessUnsignedInput): Hex;
/** Independent verifier. The official SDK creates the unsigned delegation and its CSPRNG salt. */
export declare function mmValidateUnsigned(value: unknown, input: MetaMaskGaslessUnsignedInput, reason?: MetaMaskGaslessFailureReason): MetaMaskGaslessUnsignedResult;
