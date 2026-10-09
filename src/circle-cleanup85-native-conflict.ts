import { hashObject } from "./canonical.js";
import { verifiedCleanup85RecoveryAdmission, type VerifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
export async function cleanup85ConflictExclusion(state:StateStore,proof:VerifiedCleanup85RecoveryAdmission,request:Cleanup85CancellationRequest,exceptOperation?:OperationRecord) {
  const {parent}=verifiedCleanup85RecoveryAdmission(proof,request);
  if((await new CircleRepository(state.root).load(parent.operationId))?.integrityHash!==parent.integrityHash||exceptOperation!==undefined&&(exceptOperation.profileHash!==parent.profileHash||exceptOperation.walletAddress!==parent.sourceCustody.walletAddress||exceptOperation.evm?.cleanup85Cancellation===undefined||hashObject(exceptOperation.evm.cleanup85Cancellation.request)!==hashObject(request)||(await state.findOperation(exceptOperation.operationId))?.integrityHash!==exceptOperation.integrityHash))cleanup85Blocked("conflict_exact_parent_and_native_operation");
  return {profileHash:parent.profileHash,account:parent.sourceCustody.walletAddress,parent:{operationId:parent.operationId,integrityHash:parent.integrityHash}};
}
export type { VerifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
export type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
