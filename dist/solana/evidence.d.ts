import type { ChainAccount, RailInspection, RailPreparedTransfer, RailSendBinding } from "../direct-rail-ports.js";
import { type SolanaRpcPort } from "./rpc.js";
export declare function inspectSolana(rpc: SolanaRpcPort, account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string, now: Date, send?: RailSendBinding | null): Promise<RailInspection>;
