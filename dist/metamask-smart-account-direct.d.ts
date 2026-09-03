import type { SmartAccountDirectEffectStorePort } from "./encrypted-smart-account-direct-effect-store.js";
import type { SmartAccountPermissionStorePort } from "./encrypted-smart-account-permission-store.js";
import { type GrantedSmartAccountPermissionRecord } from "./metamask-smart-account-record.js";
import type { Address, Economics, Hex } from "./model.js";
import type { RpcPort } from "./ports.js";
import type { DirectExecutionPort, ProviderDelegatedDirectPreparation, ProviderDirectExecutionInput, ProviderDirectPrepareInput } from "./provider-ports.js";
export interface SmartAccountAllowancePort {
    available(record: GrantedSmartAccountPermissionRecord): Promise<string>;
}
interface RedemptionMaterial {
    readonly childContext: Hex;
    readonly childFingerprint: string;
    readonly calldata: Hex;
}
export interface SmartAccountDelegationEnginePort {
    createRedemption(input: {
        readonly record: GrantedSmartAccountPermissionRecord;
        readonly operationId: string;
        readonly fingerprint: string;
        readonly recipient: Address;
        readonly amountAtomic: string;
        readonly preparedAt: string;
        readonly expiresAt: string;
        readonly rpcUrl: string;
    }): Promise<RedemptionMaterial>;
    signTransaction(input: {
        readonly privateKey: Hex;
        readonly delegationManager: Address;
        readonly calldata: Hex;
        readonly economics: Economics;
    }): Promise<Hex>;
}
export declare class OfficialSmartAccountAllowance implements SmartAccountAllowancePort {
    private readonly client;
    constructor(rpcUrl: string);
    available(record: GrantedSmartAccountPermissionRecord): Promise<string>;
}
export declare class OfficialSmartAccountDelegationEngine implements SmartAccountDelegationEnginePort {
    createRedemption(input: Parameters<SmartAccountDelegationEnginePort["createRedemption"]>[0]): Promise<RedemptionMaterial>;
    signTransaction(input: Parameters<SmartAccountDelegationEnginePort["signTransaction"]>[0]): Promise<Hex>;
}
export declare class MetaMaskSmartAccountDirectAdapter implements DirectExecutionPort {
    private readonly permissions;
    private readonly effects;
    private readonly rpc;
    private readonly allowance;
    private readonly engine;
    private readonly now;
    readonly mode: "delegated_session_transaction";
    constructor(permissions: SmartAccountPermissionStorePort, effects: SmartAccountDirectEffectStorePort, rpc: RpcPort, allowance: SmartAccountAllowancePort, engine?: SmartAccountDelegationEnginePort, now?: () => Date);
    prepare(input: ProviderDirectPrepareInput): Promise<ProviderDelegatedDirectPreparation>;
    preflight(input: ProviderDirectExecutionInput): Promise<void>;
    execute(input: ProviderDirectExecutionInput): Promise<{
        disposition: "ambiguous";
        reason: string;
        transactionHash?: never;
        recoveryToken?: never;
        providerState?: never;
    } | {
        disposition: "pending";
        recoveryToken: string;
        providerState: string;
        reason?: never;
        transactionHash?: never;
    } | {
        disposition: "acknowledged";
        transactionHash: `0x${string}`;
    }>;
    observe(input: {
        readonly recoveryToken: string;
        readonly sender: Address;
    }): Promise<{
        disposition: "ambiguous";
        reason: string;
        transactionHash?: never;
        recoveryToken?: never;
        providerState?: never;
    } | {
        disposition: "acknowledged";
        transactionHash: `0x${string}`;
        reason?: never;
        recoveryToken?: never;
        providerState?: never;
    } | {
        disposition: "pending";
        recoveryToken: string;
        providerState: string;
        reason?: never;
        transactionHash?: never;
    }>;
    private preflightRecord;
    private resumeEffect;
    private submit;
    private instant;
}
export {};
