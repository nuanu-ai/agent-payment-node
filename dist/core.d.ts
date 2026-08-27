import type { CommandRequest, OutputEnvelope } from "./commands.js";
import { RuntimeContext, type CoreDependencies } from "./runtime.js";
import { TransferService } from "./transfer-service.js";
import { WalletService } from "./wallet-service.js";
import { OperationService } from "./operation-service.js";
import { X402Service } from "./x402-service.js";
export type { CommandRequest, OutputEnvelope } from "./commands.js";
export type { CoreDependencies } from "./runtime.js";
export declare class ApnCore {
    readonly context: RuntimeContext;
    readonly wallet: WalletService;
    readonly transfer: TransferService;
    readonly operations: OperationService;
    readonly x402: X402Service;
    constructor(dependencies: CoreDependencies);
    execute(request: CommandRequest): Promise<OutputEnvelope>;
    private dispatch;
}
