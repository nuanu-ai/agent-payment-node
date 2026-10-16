import type { EvmChainRead } from "./evm-direct-reads.js";
import type { EvmTransferEvidence } from "./evm-ports.js";
import type { OperationRecord } from "./model.js";
import type { RpcReceipt } from "./ports.js";
/**
 * One POST after the receipt: the receipt's block by number (canonical at this node), the transaction, and the safe
 * head where finality is `safe`. Nothing is re-read around them: the block hash binds the receipt, the safe head only
 * has to have reached it, and a reorg seen by a later observation simply yields no completion here.
 */
export declare function observeEvmTransfer(read: EvmChainRead, operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
