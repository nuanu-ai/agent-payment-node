import { type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "./metamask-native-transfer-owner.js";
import { type VerifiedCleanup85RecoveryAdmission, type Cleanup85CancellationRequest } from "./circle-cleanup85-native-conflict.js";
import { type VerifiedCircleNativeAdmission } from "./circle-native-admission.js";
import { SeiFundingJournal, type SeiFundingRecord } from "./lifi/sei-gaszip-journal.js";
import { type CircleOperationV1, type CircleRole } from "./circle-v2-evm/operation-model.js";
import { MegaFundingJournal, type MegaFundingRecord } from "./lifi/mega-gaszip-journal.js";
import { type MerchantOperation } from "./x402-merchant/model.js";
import { type Permit2ProductionRecord } from "./x402-permit2/production-repository.js";
import { type Permit2LegacyConflict } from "./x402-permit2/legacy-conflicts.js";
import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import { type X402SettlementWaitProjection, type X402OperationRecord } from "./x402-state-integrity.js";
import { type ProviderX402OperationRecord } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { type RailOperationRecord } from "./rail-operation-model.js";
import { BridgeOperationRepository } from "./lifi/operation-repository.js";
import type { StoredBridgeOperationRecord } from "./lifi/legacy-operation.js";
import { GaslessOperationRepository } from "./gasless/operation-repository.js";
import type { GaslessOperationRecord } from "./gasless/operation-model.js";
import type { MetaMaskGaslessOperationRecord } from "./metamask-gasless/operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "./metamask-gasless/ports.js";
import type { SmartAccountGaslessOperationRecord } from "./smart-account-gasless/operation-model.js";
import type { SmartAccountGaslessRepositoryPort } from "./smart-account-gasless/ports.js";
import { type FacilitatorGaslessRepositoryPort } from "./facilitator-gasless/operation-repository.js";
import type { FacilitatorOperationRecord } from "./facilitator-gasless/operation-model.js";
import { RelayUnsignedOperationRepository, type RelayUnsignedOperation } from "./relay-unsigned-operation.js";
export type StoredMoneyOperation = {
    readonly kind: "sei_gaszip";
    readonly record: SeiFundingRecord;
} | {
    readonly kind: "circle_route";
    readonly record: CircleOperationV1;
} | {
    readonly kind: "mega_gaszip";
    readonly record: MegaFundingRecord;
} | {
    readonly kind: "merchant_x402";
    readonly record: MerchantOperation;
} | {
    readonly kind: "permit2_production";
    readonly record: Permit2ProductionRecord;
} | {
    readonly kind: "permit2_legacy_conflict";
    readonly record: Permit2LegacyConflict;
} | {
    readonly kind: "relay_unsigned";
    readonly record: RelayUnsignedOperation;
} | {
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
    readonly record: StoredBridgeOperationRecord;
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
    private readonly relayUnsigned;
    private readonly seiFunding;
    private readonly megaFunding;
    constructor(state: StateStore, providerX402?: ProviderX402Repository, rails?: RailOperationRepository, bridges?: BridgeOperationRepository, gasless?: GaslessOperationRepository, metaMaskGasless?: MetaMaskGaslessRepositoryPort, smartAccountGasless?: SmartAccountGaslessRepositoryPort, facilitatorGasless?: FacilitatorGaslessRepositoryPort, relayUnsigned?: RelayUnsignedOperationRepository, seiFunding?: Pick<SeiFundingJournal, "listAllOperations" | "listOperations" | "findOperation">, megaFunding?: Pick<MegaFundingJournal, "listAllOperations" | "listOperations" | "findOperation">);
    /** Create-only Relay insertion. Profile, operation, idempotency, then owner-address
     * locks are acquired together so owner validation and durable write are atomic. */
    persistRelayUnsigned(operation: RelayUnsignedOperation): Promise<RelayUnsignedOperation>;
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
    /** Only the real current foreground owner may exclude its exact own native journal claim. */
    assertMetaMaskNativeOwnedAccountAvailable(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<void>;
    assertFinalizedCircleNativeAccountAvailable(profileHash: string, account: string, proof: VerifiedCircleNativeAdmission, exceptOperation?: OperationRecord): Promise<void>;
    assertCleanup85NativeAccountAvailable(proof: VerifiedCleanup85RecoveryAdmission, request: Cleanup85CancellationRequest, exceptOperation?: OperationRecord): Promise<void>;
    /** Only a checked saved Permit2 operation can exclude its own existing conflict claim. */
    assertPermit2AccountAvailable(record: Permit2ProductionRecord): Promise<void>;
    /** A new Solana or TRON money operation waits only for unresolved operations of the same rail account. */
    assertRailAccountAvailable(profileHash: string, rail: "solana" | "tron", account: string): Promise<void>;
    private assertConflictDomainsAvailable;
    private permit2ProductionOperations;
    private permit2LegacyOperations;
    private profileOperations;
    private circleOperations;
    /** Finite unsigned retry only; IDs are derived and independently checked, never caller exclusions. */
    assertCleanup85PreparationAccountsAvailable(record: CircleOperationV1, now: number): Promise<void>;
    /** Both Circle signing accounts are held under their existing profile locks. */
    assertCircleAccountsAvailable(record: CircleOperationV1, exceptSaved?: boolean, effectRole?: CircleRole): Promise<void>;
    assertProviderAccountAvailable(providerId: string, accountBindingHash: string, payer: string, exceptOperationId?: string): Promise<void>;
    private merchantOperations;
    assertMerchantAccountAvailable(record: MerchantOperation): Promise<void>;
    required(operationId: string): Promise<StoredMoneyOperation>;
    status(operationId: string): Promise<unknown>;
    relayStatus(operation: RelayUnsignedOperation): Promise<import("./relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
    /** Source finality ends this operation's spend attempt. Destination delivery is observed separately. */
    private relaySourceCompletion;
    private relayLifecycle;
    private listAllBridgeOperations;
    private listBridgeOperations;
    private findBridgeOperation;
    x402Outcome(operationId: string, options: {
        readonly exposeSellerResult: boolean;
        readonly exposeTerminalReceipt: boolean;
        readonly settlementWait?: X402SettlementWaitProjection;
    }): Promise<CommandOutcome>;
    x402ReceiptOutcome(operationId: string): Promise<CommandOutcome>;
}
