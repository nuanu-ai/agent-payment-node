import { ApnError } from "../../errors.js";
import { mmError } from "../reasons.js";
export const MM_EVIDENCE_PREDICATES = ["rpc_method", "rpc_json", "rpc_envelope", "rpc_record", "rpc_quantity", "rpc_hex", "header_identity", "header_recheck", "protocol_code_pin", "token_proxy_code_pin", "token_decimals", "token_implementation_address", "token_implementation_code_pin", "owner_designation", "snapshot_block_order", "snapshot_state_binding", "counter", "disabled_flag", "balance", "snapshot_owner_code", "snapshot_shape"];
/** Closed metadata only. No response bodies, URLs, credentials or unsigned material. */
export function mmEvidenceFail(reason, predicate, method) {
    const base = mmError(reason);
    throw new ApnError(base.code, base.message, { reason, evidenceStage: "chain_evidence",
        evidencePredicate: predicate, ...(method === undefined ? {} : { evidenceMethod: method }) });
}
export async function mmEvidenceAt(stage, action) {
    try {
        return await action();
    }
    catch (error) {
        if (!(error instanceof ApnError))
            throw error;
        throw new ApnError(error.code, error.message, { ...error.details, evidenceStage: stage });
    }
}
export function mmEvidenceStateAt(stage, action) {
    try {
        return action();
    }
    catch (error) {
        if (!(error instanceof ApnError))
            throw error;
        throw new ApnError(error.code, error.message, { ...error.details, evidenceStage: stage,
            evidencePredicate: typeof error.details?.evidencePredicate === "string" ? error.details.evidencePredicate : "snapshot_shape" });
    }
}
//# sourceMappingURL=diagnostic.js.map