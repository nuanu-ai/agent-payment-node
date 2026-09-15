import type { Hex } from "../model.js";
import type { SmartAccountGaslessBinding, SmartAccountGaslessBlock, SmartAccountGaslessCursor, SmartAccountGaslessIntent,
  SmartAccountGaslessMaterialDescriptor, SmartAccountGaslessMaterialHashes, SmartAccountGaslessPayload,
  SmartAccountGaslessProfileIdentity, SmartAccountGaslessProviderBinding, SmartAccountGaslessProviderSettlement,
  SmartAccountGaslessRpcObservation, SmartAccountGaslessSealedMaterial, SmartAccountGaslessSnapshot,
  SmartAccountGaslessVerification } from "./model.js";
import type { SmartAccountGaslessOperationRecord, SmartAccountGaslessReceipt } from "./operation-model.js";

export interface SmartAccountGaslessMaterialPort {
  /** Ordinary retained custody read; it never connects, grants or signs. */
  inspect(expected: SmartAccountGaslessProfileIdentity, nowUnix: number): Promise<SmartAccountGaslessBinding>;
  /** Recovery only. A missing seal never implies authority to call seal again. */
  load(operation: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessSealedMaterial | null>;
  /** Called only by the invocation that durably changed signingAttempts from zero to one. */
  seal(operation: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessSealedMaterial>;
  markExposed(operation: SmartAccountGaslessOperationRecord,
    material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessSealedMaterial>;
}
/** Public transaction material is sufficient for historical proof; no live custody dependency. */
export interface SmartAccountGaslessValidationInput {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly intent: SmartAccountGaslessIntent;
  readonly paymentPayload: SmartAccountGaslessPayload;
  readonly rootContext: Hex;
}
export interface SmartAccountGaslessMaterialValidatorPort {
  validate(input: SmartAccountGaslessValidationInput): Promise<SmartAccountGaslessMaterialHashes>;
}
export interface SmartAccountGaslessProviderPort {
  supported(): Promise<SmartAccountGaslessProviderBinding>;
  verify(operation: SmartAccountGaslessOperationRecord,
    material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessVerification>;
  settle(operation: SmartAccountGaslessOperationRecord,
    material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessProviderSettlement>;
}
export interface SmartAccountGaslessObserveInput {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly intent: SmartAccountGaslessIntent;
  readonly material: SmartAccountGaslessMaterialDescriptor;
  readonly cursor: SmartAccountGaslessCursor;
  readonly transactionHint: Hex | null;
}
export interface SmartAccountGaslessRpcPort {
  readonly chainId: 8453;
  readonly endpointOrigin: string;
  readonly endpointHash: string;
  snapshot(binding: SmartAccountGaslessBinding, expectedPreparationBlock?: SmartAccountGaslessBlock): Promise<SmartAccountGaslessSnapshot>;
  /** Before first disclosure only, at the same safe anchor as the fresh authority snapshot. */
  assertUnspent(input: { readonly binding: SmartAccountGaslessBinding; readonly material: SmartAccountGaslessMaterialDescriptor;
    readonly safeBlock: SmartAccountGaslessBlock }): Promise<void>;
  observe(input: SmartAccountGaslessObserveInput): Promise<SmartAccountGaslessRpcObservation>;
}
export type SmartAccountGaslessRpcFactory = (chainId: 8453) => SmartAccountGaslessRpcPort;
export type SmartAccountGaslessObservationRpcFactory = (chainId: 8453, environmentName: string) => SmartAccountGaslessRpcPort;
export interface SmartAccountGaslessApprovalPort {
  confirm(input: { readonly operationId: string; readonly fingerprint: string; readonly exactPhrase: string;
    readonly summary: Readonly<Record<string, unknown>> }): Promise<boolean>;
}
export interface SmartAccountGaslessRepositoryPort {
  loadOperation(profileHash: string, operationId: string): Promise<SmartAccountGaslessOperationRecord | null>;
  findOperation(operationId: string): Promise<SmartAccountGaslessOperationRecord | null>;
  listOperations(profileHash: string): Promise<readonly SmartAccountGaslessOperationRecord[]>;
  listAllOperations(): Promise<readonly SmartAccountGaslessOperationRecord[]>;
  writeOperation(operation: SmartAccountGaslessOperationRecord): Promise<void>;
  persist(operation: SmartAccountGaslessOperationRecord): Promise<void>;
  repairReceipt(operation: SmartAccountGaslessOperationRecord): Promise<void>;
  loadReceipt(profileHash: string, operationId: string): Promise<SmartAccountGaslessReceipt>;
}
