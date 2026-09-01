import type { RpcPort } from "./ports.js";
import type { ProviderX402TransactionEvidencePort, ProviderX402TransactionIntent } from "./provider-x402-transaction-port.js";
import type { ProviderX402TransactionSettlementEvidence } from "./provider-x402-model.js";
export declare class BaseExactTransactionEvidence implements ProviderX402TransactionEvidencePort {
    private readonly rpc;
    constructor(rpc: RpcPort);
    observe(intent: ProviderX402TransactionIntent): Promise<ProviderX402TransactionSettlementEvidence>;
}
