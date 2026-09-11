import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import type { GaslessRpcPort } from "./ports.js";
export type GaslessSave = (op: GaslessOperationRecord, patch: Partial<GaslessMutable>) => Promise<GaslessOperationRecord>;
export declare class GaslessObservationService {
    private readonly rpc;
    private readonly save;
    constructor(rpc: GaslessRpcPort, save: GaslessSave);
    run(op: GaslessOperationRecord): Promise<GaslessOperationRecord>;
}
