import { type TtyTransferApprovalOptions } from "../../tty-approval.js";
import { GuardedSwapService } from "../service.js";
import { type SwapOperationRecord } from "../model.js";
import { SavedOrcaStableMaterialStore, type OrcaStableMaterial } from "./stable-material.js";
import { type OrcaStableAdmissionPorts } from "./stable-admission.js";
export interface OrcaStableConsentPort {
    confirm(lines: readonly string[], code: string, deadline: string): Promise<void>;
}
export declare class TtyOrcaStableConsent implements OrcaStableConsentPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(lines: readonly string[], code: string, deadline: string): Promise<void>;
}
/** Foreground owner consent reserves only the USDC principal. This path has no signer or sender. */
export declare function approveOrcaStableReservation(service: GuardedSwapService, materialStore: SavedOrcaStableMaterialStore, ports: OrcaStableAdmissionPorts, operationId: string, consent: OrcaStableConsentPort, clock: () => Date): Promise<{
    schemaVersion: "apn.orca-stable-reservation.v1";
    operation: SwapOperationRecord;
    quoteHash: string;
    materialDigest: string;
    signable: false;
    executable: false;
    signed: false;
    broadcast: false;
}>;
export declare function stableApprovalScreen(operation: SwapOperationRecord, material: OrcaStableMaterial, deadline: string): readonly string[];
