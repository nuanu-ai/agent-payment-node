import type { MerchantOperation } from "./model.js";
import { type MerchantRpcPort } from "./rpc.js";
/** Absence of effects is established by dispatch fences; canonical unchanged state is supporting evidence. */
export declare function merchantUnsentProof(rpc: MerchantRpcPort, o: MerchantOperation): Promise<string>;
