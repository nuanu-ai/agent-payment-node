import type { CommandRequest } from "./commands.js";
import type { ApnCore } from "./core.js";
import { cliHandoffDetails, createCliHandoff } from "./cli-handoff.js";
import { ApnError } from "./errors.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "./tty-approval.js";

type TransferApproveRequest = Extract<CommandRequest, { readonly command: "transfer.approve" }>;

export async function genericTransferHandoff(core: ApnCore, request: TransferApproveRequest, approval: RejectingMcpTransferApproval): Promise<void> {
  await core.context.ready();
  const operation = await core.context.state.findOperation(request.operationId);
  if (operation?.evm !== undefined && operation.state === "awaiting_approval") await approval.approve(operation);
}

export class RejectingMcpTransferApproval implements TransferApprovalPort {
  constructor(
    private readonly request: TransferApproveRequest,
    private readonly rpcUrl: string,
  ) {}

  async approve(intent: TransferApprovalIntent): Promise<void> {
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
    throw new ApnError(
      "APN_FOREGROUND_APPROVAL_REQUIRED",
      "Run the exact transfer approval command in a foreground terminal.",
      {
        approval_boundary: "foreground_tty",
        operation_id: intent.operationId,
        profile: intent.profile,
        ...cliHandoffDetails(handoff),
      },
    );
  }
}
