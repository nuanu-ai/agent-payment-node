import type { CircleKnownOperation } from "./circle-v2-evm/funding-operation.js";
import type { GaszipFundingRecord } from "./lifi/gaszip-direct-journal.js";
import type { CircleRole } from "./circle-v2-evm/operation-model.js";
import { type MerchantOperation } from "./x402-merchant/model.js";
import { type Permit2ProductionRecord } from "./x402-permit2/production-repository.js";
import type { CommandOutcome } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
import type { X402SettlementWaitProjection, X402OperationRecord } from "./x402-state-integrity.js";
import type { ProviderX402OperationRecord } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import type { RailOperationRecord } from "./rail-operation-model.js";
import type { StoredBridgeOperationRecord } from "./lifi/legacy-operation.js";
import type { GaslessOperationRecord } from "./gasless/operation-model.js";
import type { MetaMaskGaslessOperationRecord } from "./metamask-gasless/operation-model.js";
import type { SmartAccountGaslessOperationRecord } from "./smart-account-gasless/operation-model.js";
import type { FacilitatorOperationRecord } from "./facilitator-gasless/operation-model.js";
import { type RelayUnsignedOperation } from "./relay-unsigned-operation.js";
export type StoredMoneyOperation = {
    readonly kind: "sei_gaszip";
    readonly record: GaszipFundingRecord;
} | {
    readonly kind: "circle_route";
    readonly record: CircleKnownOperation;
} | {
    readonly kind: "mega_gaszip";
    readonly record: GaszipFundingRecord;
} | {
    readonly kind: "merchant_x402";
    readonly record: MerchantOperation;
} | {
    readonly kind: "permit2_production";
    readonly record: Permit2ProductionRecord;
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
/**
 * The money-operation facade over the operation index (src/operation-index): idempotency, lookup and the
 * one-operation-per-account guard read one index entry and at most the blocking records, never every store.
 * Repository ports that older call sites still pass are not read: each family is read through its index adapter.
 */
export declare class OperationService {
    private readonly state;
    private readonly providerX402;
    private readonly index;
    constructor(state: StateStore, providerX402?: Pick<ProviderX402Repository, "loadReceipt">, ..._unreadPorts: readonly unknown[]);
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
    /** R8 (OWNR-16): a native Arbitrum move to a local custody wallet does not wait for this account's Circle routes whose source burn is final. */
    assertEvmNativeAccountAvailableBesideSettledCircle(profileHash: string, account: string): Promise<void>;
    /** A local EIP-3009 x402 purchase waits only for exclusive claims on its chain and account, never for another purchase. */
    assertEvmAccountSharedAvailable(profileHash: string, chainId: number | string, account: string): Promise<void>;
    /** The account check of one saved operation, excluding only that operation's own claim; its owner holds the account locks. */
    assertEvmAccountAvailableExcept(profileHash: string, chainId: number | string, account: string, exceptOperationId: string): Promise<void>;
    /** Only a checked saved Permit2 operation can exclude its own existing conflict claim. */
    assertPermit2AccountAvailable(record: Permit2ProductionRecord): Promise<void>;
    /** A new Solana or TRON money operation waits only for unresolved operations of the same rail account. */
    assertRailAccountAvailable(profileHash: string, rail: "solana" | "tron", account: string): Promise<void>;
    private assertConflictDomainsAvailable;
    /** Both Circle signing accounts are held under their existing profile locks. */
    assertCircleAccountsAvailable(record: CircleKnownOperation, exceptSaved?: boolean, effectRole?: CircleRole): Promise<void>;
    /** The provider account and payer are held across profiles by provider direct and provider x402 operations. */
    assertProviderAccountAvailable(providerId: string, accountBindingHash: string, payer: string, exceptOperationId?: string): Promise<void>;
    assertMerchantAccountAvailable(record: MerchantOperation): Promise<void>;
    required(operationId: string): Promise<StoredMoneyOperation>;
    status(operationId: string): Promise<unknown>;
    relayStatus(operation: RelayUnsignedOperation): Promise<import("./relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
    x402Outcome(operationId: string, options: {
        readonly exposeSellerResult: boolean;
        readonly exposeTerminalReceipt: boolean;
        readonly settlementWait?: X402SettlementWaitProjection;
    }): Promise<CommandOutcome>;
    x402ReceiptOutcome(operationId: string): Promise<CommandOutcome>;
    private requiredX402;
    /** The record behind an entry through its family's own reader (its errors propagate); null when absent. */
    private stored;
}
