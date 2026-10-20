import { COMMANDS } from "./command-catalog.js";
import { cliHandoffDetails, createCliHandoff, type CliHandoff } from "./cli-handoff.js";
import type { CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import { x402Asset, x402Chain } from "./x402-network.js";
import { X402_PAYEES_UNRESTRICTED, canonicalX402Payees } from "./profile-policy.js";
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
      (intent.x402Network?.chainId ?? 8453) !== (this.request.chainId ?? 8453) ||
      (intent.x402Network !== undefined && intent.x402Network.token !== x402Asset(this.request.chainId ?? 8453, this.request.asset).token) ||
      intent.maxBalanceUsdcAtomic !== this.request.maxBalanceUsdcAtomic ||
      intent.maxX402AmountAtomic !== this.request.maxX402AmountAtomic ||
      (this.request.maxBalanceEthWei !== undefined && intent.maxBalanceEthWei !== this.request.maxBalanceEthWei) ||
      (this.request.x402Payees !== undefined && JSON.stringify(intent.x402Payees ?? null) !== JSON.stringify(canonicalX402Payees(this.request.x402Payees)))
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
    "--chain": request.chainId === undefined ? undefined : `eip155:${x402Chain(request.chainId)}`,
    "--asset": request.asset,
    "--profile": request.profile,
    "--max-balance-usdc-atomic": request.maxBalanceUsdcAtomic,
    "--max-x402-amount-atomic": request.maxX402AmountAtomic,
    "--max-balance-eth-wei": request.maxBalanceEthWei,
    "--x402-payees": request.x402Payees === undefined ? undefined : request.x402Payees === null ? X402_PAYEES_UNRESTRICTED : request.x402Payees.join(","),
  };
  const tokens = ["apn", ...definition.path];
  for (const option of definition.options) {
    const value = values[option.name];
    if (value !== undefined) tokens.push(option.name, value);
  }
  return createCliHandoff(tokens);
}
