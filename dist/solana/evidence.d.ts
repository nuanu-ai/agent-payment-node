import type { ChainAccount, RailInspection, RailPreparedTransfer } from "../direct-rail-ports.js";
import { type SolanaRpcPort } from "./rpc.js";
export declare function inspectSolana(rpc: SolanaRpcPort, account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, now: Date): Promise<RailInspection>;
