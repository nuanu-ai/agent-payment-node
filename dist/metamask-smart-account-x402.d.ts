import type { SmartAccountX402MaterialStorePort } from "./encrypted-smart-account-x402-material-store.js";
import type { SmartAccountPermissionStorePort } from "./encrypted-smart-account-permission-store.js";
import { type GrantedSmartAccountPermissionRecord } from "./metamask-smart-account-record.js";
import type { SmartAccountAllowancePort } from "./metamask-smart-account-direct.js";
import type { Address, Hex } from "./model.js";
import type { RpcPort } from "./ports.js";
import type { X402DelegatedMaterialBinding, X402MaterialPrepareInput, X402PaymentMaterialPort, X402SealedPaymentMaterial } from "./provider-ports.js";
import { type X402PaymentPayload as PaymentPayload } from "./x402-codec.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export interface SmartAccountX402EnginePort {
    create(input: {
        readonly record: GrantedSmartAccountPermissionRecord;
        readonly operation: X402OperationRecord;
        readonly approvedFacilitators: readonly Address[];
    }): Promise<PaymentPayload>;
}
export declare class OfficialSmartAccountX402Engine implements SmartAccountX402EnginePort {
    create(input: Parameters<SmartAccountX402EnginePort["create"]>[0]): Promise<PaymentPayload>;
}
export declare class MetaMaskSmartAccountX402Adapter implements X402PaymentMaterialPort {
    private readonly permissions;
    private readonly materials;
    private readonly rpc;
    private readonly allowance;
    private readonly engine;
    private readonly now;
    private readonly approvedFacilitators;
    readonly method: "erc7710";
    constructor(permissions: SmartAccountPermissionStorePort, materials: SmartAccountX402MaterialStorePort, rpc: RpcPort, allowance: SmartAccountAllowancePort, engine?: SmartAccountX402EnginePort, now?: () => Date, approvedFacilitators?: readonly Address[]);
    prepare(input: X402MaterialPrepareInput): Promise<X402DelegatedMaterialBinding>;
    materialize(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial>;
    recover(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial>;
    markExposed(operation: X402OperationRecord): Promise<void>;
    private recovered;
    private preflightRecord;
    private nowUnix;
    private instant;
}
export declare function sameDelegationSalt(actual: Hex, expected: Hex): boolean;
