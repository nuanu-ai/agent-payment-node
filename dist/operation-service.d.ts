import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { type X402SettlementWaitProjection, type X402OperationRecord } from "./x402-state-integrity.js";
import { type ProviderX402OperationRecord } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { type RailOperationRecord } from "./rail-operation-model.js";
import { BridgeOperationRepository } from "./lifi/operation-repository.js";
import type { BridgeOperationRecord } from "./lifi/operation-model.js";
import { GaslessOperationRepository } from "./gasless/operation-repository.js";
import type { GaslessOperationRecord } from "./gasless/operation-model.js";
import type { MetaMaskGaslessOperationRecord } from "./metamask-gasless/operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "./metamask-gasless/ports.js";
import type { SmartAccountGaslessOperationRecord } from "./smart-account-gasless/operation-model.js";
import type { SmartAccountGaslessRepositoryPort } from "./smart-account-gasless/ports.js";
import { type FacilitatorGaslessRepositoryPort } from "./facilitator-gasless/operation-repository.js";
import type { FacilitatorOperationRecord } from "./facilitator-gasless/operation-model.js";
export type StoredMoneyOperation = {
    readonly kind: "facilitator_gasless_transfer";
    readonly record: FacilitatorOperationRecord;
} | {
    readonly kind: "smart_account_gasless_transfer";
    readonly record: SmartAccountGaslessOperationRecord;
} | {
    readonly kind: "metamask_gasless_transfer";
    readonly record: MetaMaskGaslessOperationRecord;
} | {
    readonly kind: "gasless_transfer";
    readonly record: GaslessOperationRecord;
} | {
    readonly kind: "bridge_route";
    readonly record: BridgeOperationRecord;
} | {
    readonly kind: "rail_transfer";
    readonly record: RailOperationRecord;
} | {
    readonly kind: "direct_transfer";
    readonly record: OperationRecord;
} | {
    readonly kind: "x402_fetch";
    readonly strategy: "local";
    readonly record: X402OperationRecord;
} | {
    readonly kind: "x402_fetch";
    readonly strategy: "provider_atomic";
    readonly record: ProviderX402OperationRecord;
};
export declare class OperationService {
    private readonly state;
    private readonly providerX402;
    private readonly rails;
    private readonly bridges;
    private readonly gasless;
    private readonly metaMaskGasless;
    private readonly smartAccountGasless;
    private readonly facilitatorGasless;
    constructor(state: StateStore, providerX402?: ProviderX402Repository, rails?: RailOperationRepository, bridges?: BridgeOperationRepository, gasless?: GaslessOperationRepository, metaMaskGasless?: MetaMaskGaslessRepositoryPort, smartAccountGasless?: SmartAccountGaslessRepositoryPort, facilitatorGasless?: FacilitatorGaslessRepositoryPort);
    resolvePrepare(input: {
        readonly kind: StoredMoneyOperation["kind"];
        readonly profileHash: string;
        readonly operationId: string;
        readonly idempotencyHash: string;
        readonly requestHash: string;
    }): Promise<StoredMoneyOperation | null>;
    /** Pure lookup lets callers defer to the full prepare resolver before any lifecycle upgrade. */
    findIdempotency(idempotencyHash: string): Promise<StoredMoneyOperation | null>;
    assertProfileAvailable(profileHash: string): Promise<void>;
    /** A new EVM money operation waits only for unresolved operations on the same chain and sending account. */
    assertEvmAccountAvailable(profileHash: string, chainId: number | string, account: string): Promise<void>;
    /** A new Solana or TRON money operation waits only for unresolved operations of the same rail account. */
    assertRailAccountAvailable(profileHash: string, rail: "solana" | "tron", account: string): Promise<void>;
    private assertConflictDomainsAvailable;
    private profileOperations;
    assertProviderAccountAvailable(providerId: string, accountBindingHash: string, payer: string, exceptOperationId?: string): Promise<void>;
    required(operationId: string): Promise<StoredMoneyOperation>;
    status(operationId: string): Promise<unknown>;
    x402Outcome(operationId: string, options: {
        readonly exposeSellerResult: boolean;
        readonly exposeTerminalReceipt: boolean;
        readonly settlementWait?: X402SettlementWaitProjection;
    }): Promise<CommandOutcome>;
    x402ReceiptOutcome(operationId: string): Promise<CommandOutcome>;
}
