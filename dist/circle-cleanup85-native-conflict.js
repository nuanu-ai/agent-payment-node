import { hashObject } from "./canonical.js";
import { verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
export async function cleanup85ConflictExclusion(state, proof, request, exceptOperation) {
    const { parent } = verifiedCleanup85RecoveryAdmission(proof, request);
    if ((await new CircleRepository(state.root).load(parent.operationId))?.integrityHash !== parent.integrityHash || exceptOperation !== undefined && (exceptOperation.profileHash !== parent.profileHash || exceptOperation.walletAddress !== parent.sourceCustody.walletAddress || exceptOperation.evm?.cleanup85Cancellation === undefined || hashObject(exceptOperation.evm.cleanup85Cancellation.request) !== hashObject(request) || (await state.findOperation(exceptOperation.operationId))?.integrityHash !== exceptOperation.integrityHash))
        cleanup85Blocked("conflict_exact_parent_and_native_operation");
    return { profileHash: parent.profileHash, account: parent.sourceCustody.walletAddress, parent: { operationId: parent.operationId, integrityHash: parent.integrityHash } };
}
//# sourceMappingURL=circle-cleanup85-native-conflict.js.map