import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Hex } from "../model.js";
import type { StateStore } from "../state.js";
import type { FacilitatorOperationRecord } from "./operation-model.js";
export interface FacilitatorSignerPort {
    /** Signs the frozen authorization of an approved, unexposed operation. The signature is returned, never stored. */
    sign(operation: FacilitatorOperationRecord): Promise<Hex>;
}
export declare class LocalFacilitatorSigner implements FacilitatorSignerPort {
    private readonly state;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    sign(input: FacilitatorOperationRecord): Promise<Hex>;
}
