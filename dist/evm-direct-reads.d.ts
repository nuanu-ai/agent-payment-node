import { type DirectEvmChainId } from "./evm-direct-networks.js";
import type { EvmDirectReads } from "./evm-ports.js";
export declare const OP_STACK_GAS_ORACLE = "0x420000000000000000000000000000000000000F";
export declare const OP_STACK_GAS_ORACLE_ABI: readonly [{
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
/**
 * Physical POSTs of each phase of a direct EVM step. Every phase below is one `read`, so one POST; the endpoint's
 * chain id rides inside the first POST of the invocation and never costs one of its own.
 */
export declare const DIRECT_EVM_READ_PLAN: {
    readonly balance: 1;
    readonly nonceEstimate: 1;
    readonly opStackFees: 1;
    readonly send: 1;
    readonly receipt: 1;
    readonly evidence: 1;
    readonly unlanded: 1;
};
/** The cap of a step is its planned POSTs times this: one more attempt of every planned POST, never an open-ended loop. */
export declare const DIRECT_EVM_BUDGET_HEADROOM = 2;
export type DirectEvmStep = "balance" | "prepare" | "approve" | "resume";
/** The hard POST cap of one direct EVM step, derived from the read plan above rather than counted by hand. */
export declare function directEvmStepBudget(chainId: DirectEvmChainId, step: DirectEvmStep): number;
export type EvmChainRead = (calls: readonly {
    readonly method: string;
    readonly params: readonly unknown[];
}[]) => Promise<readonly unknown[]>;
/**
 * One direct transfer step on one network. Balances, nonce and estimate are each read in one POST at the endpoint's
 * latest head; no header is re-read around them. A funding read is advisory before signing: the chain itself enforces
 * nonce and balance, and the frozen fee budget bounds what the signed transaction may cost.
 */
export declare function evmDirectReads(chainId: DirectEvmChainId, read: EvmChainRead, rpcOrigin: string, maximumSignedBytes: number): EvmDirectReads;
