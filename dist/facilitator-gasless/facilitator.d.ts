import { type GaslessTransport } from "../gasless/https.js";
import type { Address, Hex } from "../model.js";
import type { FacilitatorAuthorization, FacilitatorRequirement } from "./requirement.js";
export interface FacilitatorPayment {
    readonly requirement: FacilitatorRequirement;
    readonly authorization: FacilitatorAuthorization;
    readonly signature: Hex;
}
export interface FacilitatorSupport {
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly signers: readonly Address[];
    readonly supportedResponseHash: string;
    readonly observedAt: string;
}
export interface FacilitatorVerification {
    readonly observedAt: string;
    readonly payer: Address;
    readonly responseHash: string;
}
export interface FacilitatorSettlement {
    readonly observedAt: string;
    readonly transactionHash: Hex | null;
    readonly pending: boolean;
    readonly responseHash: string;
}
export interface FacilitatorPort {
    supported(): Promise<FacilitatorSupport>;
    verify(payment: FacilitatorPayment): Promise<FacilitatorVerification>;
    settle(payment: FacilitatorPayment): Promise<FacilitatorSettlement>;
}
/** Exactly one transport call per method; the lifecycle owns every durable marker around it. */
export declare class PayAiFacilitator implements FacilitatorPort {
    private readonly transport;
    private readonly now;
    constructor(transport?: GaslessTransport, now?: () => Date);
    supported(): Promise<FacilitatorSupport>;
    verify(payment: FacilitatorPayment): Promise<FacilitatorVerification>;
    settle(payment: FacilitatorPayment): Promise<FacilitatorSettlement>;
    private call;
}
