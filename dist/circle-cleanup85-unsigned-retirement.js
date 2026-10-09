import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
export async function resolveCleanup85NativeLineage(_state, _request) { cleanup85Blocked("unsigned_retirement_not_implemented"); }
export function verifiedCleanup85NativeLineage(_token, _state, _request) { cleanup85Blocked("unsigned_retirement_private_lineage_required"); }
export async function verifyCleanup85SuccessorFinancialAdmission(_state, _source, _destination, _request, _now) { cleanup85Blocked("unsigned_retirement_not_implemented"); }
export function verifiedCleanup85SuccessorFinancialAdmission(_token, _state, _request) { cleanup85Blocked("unsigned_retirement_private_admission_required"); }
//# sourceMappingURL=circle-cleanup85-unsigned-retirement.js.map