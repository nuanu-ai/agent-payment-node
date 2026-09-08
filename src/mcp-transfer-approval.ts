import type { CommandRequest } from "./commands.js";
import type { ApnCore } from "./core.js";
import { cliHandoffDetails, createCliHandoff } from "./cli-handoff.js";
import { ApnError } from "./errors.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "./tty-approval.js";
import type { RailApprovalPort } from "./direct-rail-ports.js";

type TransferApproveRequest = Extract<CommandRequest, { readonly command: "transfer.approve" }>;

export async function genericTransferHandoff(core: ApnCore, request: TransferApproveRequest, approval: RejectingMcpTransferApproval): Promise<void> {
  await core.context.ready();
  const stored = await core.operations.required(request.operationId);
  if (stored.kind === "rail_transfer" && stored.record.state === "awaiting_approval") {
    const rail = stored.record;
    await new RejectingMcpRailApproval().approve({ account: rail.account, operationId: rail.operationId,
      fingerprint: rail.fingerprint, policyHash: rail.policyHash, prepared: rail.prepared });
  }
  const operation = await core.context.state.findOperation(request.operationId);
  if (operation?.evm !== undefined && operation.state === "awaiting_approval") await approval.approve(operation);
}

export class RejectingMcpTransferApproval implements TransferApprovalPort {
  constructor(
    private readonly request: TransferApproveRequest,
    private readonly rpcUrl?: string,
  ) {}

  async approve(intent: TransferApprovalIntent): Promise<void> {
    if (this.rpcUrl === undefined) throw new ApnError("APN_RPC_CONFIG", "EVM transfer approval requires an explicit RPC URL.");
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

export class RejectingMcpRailApproval implements RailApprovalPort {
  async approve(input: Parameters<RailApprovalPort["approve"]>[0]): Promise<void> {
    const handoff = createCliHandoff(["apn", "pay", "transfer", "approve", "--operation", input.operationId]);
    throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Run this exact direct-rail approval command in a foreground terminal with APN_SOLANA_RPC_URL configured.", {
      approval_boundary: "foreground_tty", operation_id: input.operationId, profile: input.account.profile, ...cliHandoffDetails(handoff),
    });
  }
}
