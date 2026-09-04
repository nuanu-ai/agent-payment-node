import { COMMANDS } from "./command-catalog.js";
import { cliHandoffDetails, createCliHandoff, type CliHandoff } from "./cli-handoff.js";
import type { CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import type { ProfilePolicyApprovalIntent, ProfilePolicyApprovalPort } from "./policy-approval.js";

type PolicySetRequest = Extract<CommandRequest, { readonly command: "wallet.policy.set" }>;

export class RejectingMcpPolicyApproval implements ProfilePolicyApprovalPort {
  private readonly handoff: CliHandoff;

  constructor(private readonly request: PolicySetRequest) {
    this.handoff = policyHandoff(request);
  }

  async approve(intent: ProfilePolicyApprovalIntent): Promise<void> {
    if (
      intent.profile !== this.request.profile ||
      intent.maxBalanceUsdcAtomic !== this.request.maxBalanceUsdcAtomic ||
      intent.maxX402AmountAtomic !== this.request.maxX402AmountAtomic ||
      (this.request.maxBalanceEthWei !== undefined && intent.maxBalanceEthWei !== this.request.maxBalanceEthWei)
    ) {
      throw new ApnError("APN_INTERNAL", "The policy approval handoff does not match the validated request.");
    }
    throw new ApnError(
      "APN_FOREGROUND_APPROVAL_REQUIRED",
      "Run the exact policy command in a foreground terminal.",
      { ...cliHandoffDetails(this.handoff), approval_boundary: "foreground_tty" },
    );
  }
}

function policyHandoff(request: PolicySetRequest): CliHandoff {
  const definition = COMMANDS.find((command) => command.path.join(" ") === "wallet policy set");
  if (definition === undefined) throw new ApnError("APN_INTERNAL", "The policy command is absent from the command manifest.");
  const values: Readonly<Record<string, string | undefined>> = {
    "--profile": request.profile,
    "--max-balance-usdc-atomic": request.maxBalanceUsdcAtomic,
    "--max-x402-amount-atomic": request.maxX402AmountAtomic,
    "--max-balance-eth-wei": request.maxBalanceEthWei,
  };
  const tokens = ["apn", ...definition.path];
  for (const option of definition.options) {
    const value = values[option.name];
    if (value !== undefined) tokens.push(option.name, value);
  }
  return createCliHandoff(tokens);
}
