import type { Economics, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
/** The frozen signed envelope still lands: same nonce, gas within the signed limit, and today's base fee within the signed max fee. */
export declare function frozenEconomicsRemainExecutable(current: Economics, frozen: Economics): boolean;
export declare function checkEvmTransferFunding(rpcPort: RpcPort, operation: OperationRecord, beforeSigning: boolean, stateRoot?: string): Promise<void>;
export declare function evmCustodyPayload(operation: OperationRecord): Readonly<Record<string, unknown>>;
