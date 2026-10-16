import type { Hex } from "../model.js";
import type { GaslessIntent, GaslessSettlement } from "./model.js";
export declare function validateGaslessSettlement(i: GaslessIntent, userOperationHash: Hex, value: unknown): GaslessSettlement;
/**
 * Later safe observations can establish cleanup, but cannot replace the proven effect: the receipt identity, inclusion
 * block, transaction proof, protocol hash and log accounting. Both accounts are state reads at the observing safe head
 * (older records read `effectAccount` at the inclusion block), so they may move between observations.
 */
export declare function gaslessSettlementEffect(p: GaslessSettlement): {
    chainId: import("./model.js").GaslessChainId;
    userOperationHash: Hex;
    transactionHash: Hex;
    block: import("./model.js").GaslessBlock;
    outerSender: import("../model.js").Address;
    transactionProofHash: string;
    receiptHash: string;
    protocolHash: string;
    accounting: import("./model.js").GaslessAccounting;
};
export declare function assertGaslessSettlementContinuation(previous: GaslessSettlement, next: GaslessSettlement): void;
export declare function gaslessSettlementHash(p: GaslessSettlement): string;
