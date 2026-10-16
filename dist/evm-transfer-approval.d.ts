import type { Economics, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
/** The frozen signed envelope still lands: same nonce, gas within the signed limit, and today's base fee within the signed max fee. */
export declare function frozenEconomicsRemainExecutable(current: Economics, frozen: Economics): boolean;
/**
 * The one pre-sign check of a frozen transfer: balance, pending nonce, estimate and the fee quote, read in two POSTs
 * (three on OP-stack networks). It runs before signing only; nothing re-reads funding once a signature exists, because the
 * chain itself enforces nonce and balance and the signed gas limit and max fee bound what the transaction may cost.
 */
export declare function checkEvmTransferFunding(rpcPort: RpcPort, operation: OperationRecord, stateRoot?: string): Promise<void>;
export declare function evmCustodyPayload(operation: OperationRecord): Readonly<Record<string, unknown>>;
