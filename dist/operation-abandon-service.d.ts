import type { RailOperationService } from "./rail-operation-service.js";
import type { RuntimeContext } from "./runtime.js";
export declare class OperationAbandonService {
    private readonly context;
    private readonly rails;
    private readonly operations;
    private readonly durable;
    constructor(context: RuntimeContext, rails: RailOperationService);
    abandon(operationIdInput: string): Promise<unknown>;
    private abandonRail;
}
