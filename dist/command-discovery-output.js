import { randomUUID } from "node:crypto";
import { OUTPUT_VERSION } from "./constants.js";
export function usageFailureEnvelope(error, nextActions) {
    return {
        version: OUTPUT_VERSION,
        request_id: randomUUID(),
        command: "invalid",
        ok: false,
        proof_class: "classified_failure",
        data: null,
        operation: null,
        receipt: null,
        error,
        next_actions: nextActions,
    };
}
//# sourceMappingURL=command-discovery-output.js.map