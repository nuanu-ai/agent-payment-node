import type { CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "./tty-approval.js";

type TransferApproveRequest = Extract<CommandRequest, { readonly command: "transfer.approve" }>;

export class RejectingMcpTransferApproval implements TransferApprovalPort {
  constructor(
    private readonly request: TransferApproveRequest,
    private readonly rpcUrl: string,
  ) {}

  async approve(intent: TransferApprovalIntent): Promise<void> {
    if (intent.operationId !== this.request.operationId) {
      throw new ApnError("APN_INTERNAL", "The transfer approval handoff does not match the validated request.");
    }
    const cliHandoff = [
      "apn pay transfer approve --operation",
      intent.operationId,
      "--rpc-url",
      this.rpcUrl,
    ].join(" ");
    throw new ApnError(
      "APN_FOREGROUND_APPROVAL_REQUIRED",
      "Run the exact transfer approval command in a foreground terminal.",
      {
        approval_boundary: "foreground_tty",
        operation_id: intent.operationId,
        profile: intent.profile,
        cli_handoff: cliHandoff,
      },
    );
  }
}
