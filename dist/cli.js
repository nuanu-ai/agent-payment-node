import { randomUUID } from "node:crypto";
import { bindArgv } from "./command-binder.js";
import { catalogNextActions } from "./command-catalog.js";
import { OUTPUT_VERSION } from "./constants.js";
import { asApnError } from "./errors.js";
import { effectiveStateRoot, executeBoundCommand, } from "./runtime-factory.js";
export { effectiveStateRoot };
export function parseArgv(argv) {
    return bindArgv(argv);
}
export async function runCli(argv, _environment = process.env, options = {}) {
    try {
        return await executeBoundCommand(parseArgv(argv), options);
    }
    catch (error) {
        const safe = asApnError(error);
        return {
            version: OUTPUT_VERSION,
            request_id: randomUUID(),
            command: "invalid",
            ok: false,
            proof_class: "classified_failure",
            data: null,
            operation: null,
            receipt: null,
            error: { code: safe.code, message: safe.message, ...(safe.details === undefined ? {} : { details: safe.details }) },
            next_actions: catalogNextActions(argv),
        };
    }
}
//# sourceMappingURL=cli.js.map