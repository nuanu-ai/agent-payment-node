import type { CommandRequest, OutputEnvelope } from "./commands.js";
import { RuntimeContext, type CoreDependencies } from "./runtime.js";
import { TransferService } from "./transfer-service.js";
import { WalletService } from "./wallet-service.js";
export type { CommandRequest, OutputEnvelope } from "./commands.js";
export type { CoreDependencies } from "./runtime.js";
export declare class ApnCore {
    readonly context: RuntimeContext;
    readonly wallet: WalletService;
    readonly transfer: TransferService;
    constructor(dependencies: CoreDependencies);
    execute(request: CommandRequest): Promise<OutputEnvelope>;
    private dispatch;
}
