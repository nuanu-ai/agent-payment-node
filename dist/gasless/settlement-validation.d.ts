import type { Hex } from "../model.js";
import type { GaslessAccountState, GaslessIntent, GaslessSettlement } from "./model.js";
export declare function validateGaslessSettlement(i: GaslessIntent, userOperationHash: Hex, value: unknown): GaslessSettlement;
/** Later safe observations can establish cleanup, but cannot replace the proven effect. */
export declare function gaslessSettlementEffect(p: GaslessSettlement): {
    chainId: import("./model.js").GaslessChainId;
    userOperationHash: Hex;
    transactionHash: Hex;
    block: import("./model.js").GaslessBlock;
    outerSender: import("../model.js").Address;
    transactionProofHash: string;
    receiptHash: string;
    protocolHash: string;
    effectAccount: GaslessAccountState;
    accounting: import("./model.js").GaslessAccounting;
};
export declare function assertGaslessSettlementContinuation(previous: GaslessSettlement, next: GaslessSettlement): void;
export declare function gaslessSettlementHash(p: GaslessSettlement): string;
