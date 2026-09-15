import { hashObject } from "../canonical.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type {
  GaslessBootstrapMaterial,
  GaslessSealedMaterial,
  GaslessUserOperationMaterial,
} from "./ports.js";
import { verifyGaslessBootstrap, verifyGaslessUserOperation } from "./signature.js";
import {
  gaslessExact,
  gaslessFailure,
  gaslessHash,
  gaslessHex,
  gaslessSame,
} from "./validation.js";
import { gaslessSignedFees, gaslessUserOperation, validateGaslessWire } from "./wire.js";

const BASE_KEYS = [
  "schemaVersion", "profileHash", "operationId", "role", "fingerprint", "envelopeHash",
] as const;

export async function validateGaslessMaterial(
  value: unknown,
  operation: GaslessOperationRecord,
  role: GaslessRole,
  originalBootstrap?: GaslessBootstrapMaterial,
): Promise<GaslessSealedMaterial> {
  if (role === "bootstrap") return await validateBootstrap(value, operation);
  if (role === "user_operation") return await validateUserOperation(value, operation, originalBootstrap);
  return gaslessFailure("APN_STATE_CORRUPT", "gasless_effect_role");
}

async function validateBootstrap(
  value: unknown,
  operation: GaslessOperationRecord,
): Promise<GaslessBootstrapMaterial> {
  const record = gaslessExact(value, [
    ...BASE_KEYS, "permitSignature", "authorization", "materialHash",
  ]);
  validateBase(record, operation, "bootstrap");
  const permitSignature = gaslessHex(record.permitSignature, 65, 65, "APN_STATE_CORRUPT");
  if (permitSignature !== record.permitSignature) corrupt("gasless_bootstrap_signature_encoding");
  const { materialHash, ...body } = record;
  gaslessHash(materialHash);
  if (materialHash !== hashObject(body)) corrupt("gasless_effect_material_hash");
  const material = record as unknown as GaslessBootstrapMaterial;
  if ((operation.intent.initialSnapshot.delegation === "empty") !== (material.authorization !== null)) {
    corrupt("gasless_bootstrap_delegation_binding");
  }
  committedMaterial(operation, "bootstrap", material.materialHash, null);
  await verifyGaslessBootstrap(operation.intent, {
    permitSignature: material.permitSignature,
    authorization: material.authorization,
  });
  return material;
}

async function validateUserOperation(
  value: unknown,
  operation: GaslessOperationRecord,
  originalBootstrap?: GaslessBootstrapMaterial,
): Promise<GaslessUserOperationMaterial> {
  const record = gaslessExact(value, [
    ...BASE_KEYS, "bootstrapMaterialHash", "estimateHash", "userOperation", "userOperationHash", "materialHash",
  ]);
  validateBase(record, operation, "user_operation");
  gaslessHash(record.bootstrapMaterialHash);
  gaslessHash(record.estimateHash);
  const userOperationHash = gaslessHex(record.userOperationHash, 32, 32, "APN_STATE_CORRUPT");
  if (userOperationHash !== record.userOperationHash) corrupt("gasless_user_operation_hash_encoding");
  const { materialHash, ...body } = record;
  gaslessHash(materialHash);
  if (materialHash !== hashObject(body)) corrupt("gasless_effect_material_hash");
  if (originalBootstrap === undefined || operation.bootstrap.materialHash === null ||
    record.bootstrapMaterialHash !== originalBootstrap.materialHash ||
    record.bootstrapMaterialHash !== operation.bootstrap.materialHash) {
    corrupt("gasless_bootstrap_material_binding");
  }
  if (operation.bootstrap.estimate === null || record.estimateHash !== hashObject(operation.bootstrap.estimate)) {
    corrupt("gasless_estimate_material_binding");
  }
  const wire = validateGaslessWire(operation.intent, record.userOperation);
  const expected = gaslessUserOperation(operation.intent, originalBootstrap, wire.signature,
    gaslessSignedFees(operation.intent, wire));
  if (!gaslessSame(wire, expected)) corrupt("gasless_original_bootstrap_wire_binding");
  const verifiedHash = await verifyGaslessUserOperation(operation.intent, wire);
  if (verifiedHash !== userOperationHash) corrupt("gasless_user_operation_hash_binding");
  const material = record as unknown as GaslessUserOperationMaterial;
  committedMaterial(operation, "user_operation", material.materialHash, material.userOperationHash);
  return material;
}

function validateBase(
  record: Record<string, unknown>,
  operation: GaslessOperationRecord,
  role: GaslessRole,
): void {
  if (record.schemaVersion !== "apn.gasless-effect.v1" || record.profileHash !== operation.profileHash ||
    record.operationId !== operation.operationId || record.role !== role ||
    record.fingerprint !== operation.fingerprint || record.envelopeHash !== operation.intent.unsignedEnvelopeHash) {
    corrupt("gasless_effect_identity");
  }
  gaslessHash(record.profileHash);
  gaslessHash(record.operationId);
  gaslessHash(record.fingerprint);
  gaslessHash(record.envelopeHash);
}

function committedMaterial(
  operation: GaslessOperationRecord,
  role: GaslessRole,
  materialHash: string,
  userOperationHash: string | null,
): void {
  const effect = role === "bootstrap" ? operation.bootstrap : operation.userOperation;
  if (effect.role !== role || (effect.materialHash !== null && effect.materialHash !== materialHash) ||
    (role === "user_operation" && effect.userOperationHash !== null && effect.userOperationHash !== userOperationHash) ||
    (role === "bootstrap" && effect.userOperationHash !== null)) {
    corrupt("gasless_committed_material_identity");
  }
}

function corrupt(reason: string): never {
  return gaslessFailure("APN_STATE_CORRUPT", reason);
}
