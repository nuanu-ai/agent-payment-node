import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import type { GaslessObservationPort } from "./ports.js";
export type GaslessSave = (op: GaslessOperationRecord, patch: Partial<GaslessMutable>) => Promise<GaslessOperationRecord>;
export declare class GaslessObservationService {
    private readonly rpc;
    private readonly save;
    private readonly recoveryEnvironment?;
    constructor(rpc: GaslessObservationPort, save: GaslessSave, recoveryEnvironment?: string | undefined);
    run(op: GaslessOperationRecord): Promise<GaslessOperationRecord>;
}
