import { cliHandoffDetails, createCliHandoff } from "./cli-handoff.js";
import { ApnError } from "./errors.js";
export class RejectingMcpTransferApproval {
    request;
    rpcUrl;
    constructor(request, rpcUrl) {
        this.request = request;
        this.rpcUrl = rpcUrl;
    }
    async approve(intent) {
        if (intent.operationId !== this.request.operationId) {
            throw new ApnError("APN_INTERNAL", "The transfer approval handoff does not match the validated request.");
        }
        const handoff = createCliHandoff([
            "apn",
            "pay",
            "transfer",
            "approve",
            "--operation",
            intent.operationId,
            "--rpc-url",
            new URL(this.rpcUrl).toString(),
        ]);
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Run the exact transfer approval command in a foreground terminal.", {
            approval_boundary: "foreground_tty",
            operation_id: intent.operationId,
            profile: intent.profile,
            ...cliHandoffDetails(handoff),
        });
    }
}
//# sourceMappingURL=mcp-transfer-approval.js.map