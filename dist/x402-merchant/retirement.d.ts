import type { StateStore } from "../state.js";
import { type MerchantOperation } from "./model.js";
import type { MerchantRpcPort } from "./rpc.js";
export declare class MerchantRetirement {
    private readonly state;
    private readonly rpc;
    private readonly now;
    constructor(state: StateStore, rpc: MerchantRpcPort, now: () => Date);
    retire(id: string): Promise<MerchantOperation>;
}
