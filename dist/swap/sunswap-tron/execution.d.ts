import type { AssetPolicyRegistry } from "../../asset-policy-registry.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
import type { SwapChainObserverPort, SwapChainSenderPort, SwapChainSignerPort } from "../ports.js";
import { GuardedSwapService } from "../service.js";
import { type SwapOperationRecord } from "../model.js";
import { type SunSwapExecutionBinding } from "./signer.js";
export interface SunSwapOwnerAdmissionInput {
    readonly profile: string;
    readonly account: string;
    readonly accountIdentityHash: string;
    readonly operationId: string;
    readonly ownerProfileHash: string;
    readonly chain: string;
}
export interface SunSwapOwnerAdmissionPort {
    admit(input: SunSwapOwnerAdmissionInput): Promise<{
        readonly admitted: true;
        readonly accountIdentityHash: string;
    }>;
}
export interface SunSwapForegroundApprovalInput {
    readonly operationId: string;
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly expectedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly slippageBps: number;
    readonly maximumEnergy: string;
    readonly energyPriceSun: string;
    readonly feeLimitSun: string;
    readonly deadlineSeconds: string;
    readonly quoteHash: string;
    readonly simulationRequestHash: string;
    readonly simulationResultHash: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
}
export interface SunSwapForegroundApproval extends SunSwapForegroundApprovalInput {
    readonly approvedAt: string;
    readonly approvalHash: string;
}
export interface SunSwapForegroundApprovalPort {
    approve(input: SunSwapForegroundApprovalInput): Promise<unknown>;
}
export interface SunSwapResourceFeeCap {
    readonly maximumEnergy: string;
    readonly energyPriceSun: string;
    readonly maximumFeeLimitSun: string;
}
export interface SunSwapExecutionDependencies {
    readonly service: GuardedSwapService;
    readonly policy: AssetPolicyRegistry;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly ownerAdmission: SunSwapOwnerAdmissionPort;
    readonly approval: SunSwapForegroundApprovalPort;
    readonly resourceFeeCap: SunSwapResourceFeeCap;
    readonly signer: SwapChainSignerPort;
    readonly sender: SwapChainSenderPort;
    readonly observer: SwapChainObserverPort;
}
/** Dormant until all authority, policy, signer, sender and observer ports are explicitly injected. */
export declare class SunSwapGuardedExecutor {
    private readonly dependencies;
    private readonly binding;
    constructor(dependencies: SunSwapExecutionDependencies, binding: SunSwapExecutionBinding);
    execute(operationValue: SwapOperationRecord, now: Date): Promise<SwapOperationRecord>;
    resume(operationValue: SwapOperationRecord, now: Date): Promise<SwapOperationRecord>;
    private observeOnly;
    private validateDependencies;
}
export declare function sealSunSwapForegroundApproval(input: SunSwapForegroundApprovalInput, approvedAt: Date): SunSwapForegroundApproval;
export declare function validateSunSwapForegroundApproval(value: unknown, expected: SunSwapForegroundApprovalInput, earliestAt: string, now: Date): SunSwapForegroundApproval;
