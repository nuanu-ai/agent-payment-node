import type { CommandRequest, OutputEnvelope } from "./commands.js";
import { RuntimeContext, type CoreDependencies } from "./runtime.js";
import { TransferService } from "./transfer-service.js";
import { WalletService } from "./wallet-service.js";
import { OperationService } from "./operation-service.js";
import { X402Service } from "./x402-service.js";
import { ProviderWalletService } from "./provider-wallet-service.js";
import { ProviderX402TransactionRecoveryService } from "./provider-x402-transaction-recovery.js";
import { ProviderPermissionService } from "./provider-permission-service.js";
export type { CommandRequest, OutputEnvelope } from "./commands.js";
export type { CoreDependencies } from "./runtime.js";
export declare class ApnCore {
    readonly context: RuntimeContext;
    readonly wallet: WalletService;
    readonly transfer: TransferService;
    readonly operations: OperationService;
    readonly x402: X402Service;
    readonly providerWallet: ProviderWalletService;
    readonly providerPermissions: ProviderPermissionService;
    readonly providerTransactionRecovery: ProviderX402TransactionRecoveryService;
    constructor(dependencies: CoreDependencies);
    execute(request: CommandRequest): Promise<OutputEnvelope>;
    private dispatch;
}
