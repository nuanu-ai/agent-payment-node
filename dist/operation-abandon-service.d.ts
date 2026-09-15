import type { RailOperationService } from "./rail-operation-service.js";
import type { RuntimeContext } from "./runtime.js";
import type { GaslessService } from "./gasless/service.js";
import type { MetaMaskGaslessService } from "./metamask-gasless/service.js";
export declare class OperationAbandonService {
    private readonly context;
    private readonly rails;
    private readonly gasless;
    private readonly metaMaskGasless;
    private readonly operations;
    private readonly durable;
    constructor(context: RuntimeContext, rails: RailOperationService, gasless: GaslessService, metaMaskGasless: MetaMaskGaslessService);
    abandon(operationIdInput: string): Promise<unknown>;
    private abandonRail;
}
