import { COMMANDS } from "./command-catalog.js";
import { cliHandoffDetails, createCliHandoff } from "./cli-handoff.js";
import { ApnError } from "./errors.js";
import { x402Network } from "./x402-network.js";
import { X402_PAYEES_UNRESTRICTED, canonicalX402Payees } from "./profile-policy.js";
export class RejectingMcpPolicyApproval {
    request;
    handoff;
    constructor(request) {
        this.request = request;
        this.handoff = policyHandoff(request);
    }
    async approve(intent) {
        if (intent.profile !== this.request.profile ||
            (intent.x402Network?.chainId ?? 8453) !== (this.request.chainId ?? 8453) ||
            (intent.x402Network !== undefined && intent.x402Network.token !== x402Network(this.request.chainId).token) ||
            intent.maxBalanceUsdcAtomic !== this.request.maxBalanceUsdcAtomic ||
            intent.maxX402AmountAtomic !== this.request.maxX402AmountAtomic ||
            (this.request.maxBalanceEthWei !== undefined && intent.maxBalanceEthWei !== this.request.maxBalanceEthWei) ||
            (this.request.x402Payees !== undefined && JSON.stringify(intent.x402Payees ?? null) !== JSON.stringify(canonicalX402Payees(this.request.x402Payees)))) {
            throw new ApnError("APN_INTERNAL", "The policy approval handoff does not match the validated request.");
        }
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Run the exact policy command in a foreground terminal.", { ...cliHandoffDetails(this.handoff), approval_boundary: "foreground_tty" });
    }
}
function policyHandoff(request) {
    const definition = COMMANDS.find((command) => command.path.join(" ") === "wallet policy set");
    if (definition === undefined)
        throw new ApnError("APN_INTERNAL", "The policy command is absent from the command manifest.");
    const values = {
        "--chain": request.chainId === undefined ? undefined : x402Network(request.chainId).network,
        "--profile": request.profile,
        "--max-balance-usdc-atomic": request.maxBalanceUsdcAtomic,
        "--max-x402-amount-atomic": request.maxX402AmountAtomic,
        "--max-balance-eth-wei": request.maxBalanceEthWei,
        "--x402-payees": request.x402Payees === undefined ? undefined : request.x402Payees === null ? X402_PAYEES_UNRESTRICTED : request.x402Payees.join(","),
    };
    const tokens = ["apn", ...definition.path];
    for (const option of definition.options) {
        const value = values[option.name];
        if (value !== undefined)
            tokens.push(option.name, value);
    }
    return createCliHandoff(tokens);
}
//# sourceMappingURL=mcp-policy-approval.js.map