import type { ChainAccount, RailInspection, RailPreparedTransfer } from "../direct-rail-ports.js";
import { type TronRpcPort } from "./rpc.js";
export declare function inspectTron(rpc: TronRpcPort, account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, expectedRawPayloadHash: string, now: Date): Promise<RailInspection>;
