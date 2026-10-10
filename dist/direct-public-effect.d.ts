import { type DirectEffectMaterial } from "./encrypted-wallet-store.js";
import { type EvmNativeCustody } from "./evm-native-custody.js";
import type { Hex, OperationRecord } from "./model.js";
import { SecureStateStore } from "./secure-state-store.js";
import type { StateStore } from "./state.js";
export declare function directCustodyPayload(operation: OperationRecord): Readonly<Record<string, unknown>>;
interface Binding {
    readonly profile: string;
    readonly operationId: string;
    readonly profileHash: string;
    readonly fingerprint: string;
    readonly payloadHash: string;
    readonly custody: EvmNativeCustody;
}
interface DirectSigningAttempt {
    readonly binding: Binding;
    readonly operationIntegrityHash: string;
    readonly preparedRecordHash: string;
    readonly signingRecordHash: string;
}
export interface DirectPublicEffect {
    readonly transactionHash: Hex;
    readonly rawTransactionHash: Hex;
}
/** Hash-only evidence. Raw signed material stays exclusively in encrypted wallet custody. */
export declare class DirectPublicEffectJournal extends SecureStateStore {
    private readonly state;
    private readonly freshAttempts;
    constructor(state: StateStore);
    private path;
    private binding;
    prepare(operation: OperationRecord): Promise<void>;
    prepared(operation: OperationRecord): Promise<Binding>;
    private assertCustody;
    assertUnstarted(operation: OperationRecord): Promise<void>;
    beginSigning(operation: OperationRecord): Promise<DirectSigningAttempt>;
    /** Called only by the catch before Native enters withWallet, with its own freshly minted attempt. */
    recordNoPrivateEntry(operation: OperationRecord, attempt: DirectSigningAttempt): Promise<void>;
    /** Absence alone grants nothing. A valid outcome belongs to exactly one canonical started attempt. */
    noPrivateEntry(operation: OperationRecord): Promise<boolean>;
    private checkNoPrivateContext;
    private syncAncestors;
    attestationMessage(operation: OperationRecord, effect: DirectPublicEffect): Promise<string>;
    private verifyAttestation;
    publish(operation: OperationRecord, effect: DirectEffectMaterial, attestation: Hex): Promise<void>;
    effect(operation: OperationRecord): Promise<DirectPublicEffect>;
    hasSigned(operation: OperationRecord): Promise<boolean>;
}
export {};
