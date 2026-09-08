import { COMMANDS } from "./command-catalog.js";
import { cliHandoffDetails, createCliHandoff, type CliHandoff } from "./cli-handoff.js";
import type { CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import { x402Network } from "./x402-network.js";
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
      (intent.x402Network !== undefined && intent.x402Network.token !== x402Network(this.request.chainId).token) ||
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
  const path = request.chainId === undefined ? "wallet policy set" : "wallet policy set-network";
  const definition = COMMANDS.find((command) => command.path.join(" ") === path);
  if (definition === undefined) throw new ApnError("APN_INTERNAL", "The policy command is absent from the command manifest.");
  const values: Readonly<Record<string, string | undefined>> = {
    "--chain": request.chainId === undefined ? undefined : x402Network(request.chainId).network,
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

export function chainPolicyHandoff(request: Extract<CommandRequest, { readonly command: "policy.admit-solana" }>): never {
  const handoff = createCliHandoff(["apn", "policy", "admit-solana", "--profile", request.profile, "--asset", request.asset,
    "--max-per-transfer", request.maximumPerTransfer, "--daily-limit", request.dailyLimit, "--max-fee-sol", request.maximumFee]);
  throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Run the exact mainnet asset admission command in a foreground terminal with APN_SOLANA_RPC_URL configured.", {
    approval_boundary: "foreground_tty", ...cliHandoffDetails(handoff),
  });
}
