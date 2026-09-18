import { ApnError } from "../errors.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { BridgeApprovalPort } from "./ports.js";
import type { publicBridgeOperation } from "./receipt.js";

export class TtyBridgeApproval implements BridgeApprovalPort {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}
  async confirm(input: Parameters<BridgeApprovalPort["confirm"]>[0]): Promise<boolean> {
    const s = input.summary as ReturnType<typeof publicBridgeOperation>;
    const from = s.asset.from, to = s.asset.to, native = s.asset.native_principal_admitted;
    const lines = ["Agent Payment Node cross-chain bridge approval", `Profile: ${s.profile}`, `Provider: ${s.provider}`,
      `Custody: ${s.custody}`, `Execution owner: ${s.execution_owner}`, `Operation: ${input.operationId}`,
      `LI.FI route: ${s.route.route_id}; tool: ${s.route.tool}`, `Source chain: eip155:${s.transfer.fromChainId}`,
      `Destination chain: eip155:${s.transfer.toChainId}`, `Source ${from.symbol}: ${from.token}`, `Destination ${to.symbol}: ${to.token}`,
      `Sender: ${s.transfer.sender}`, `Recipient: ${s.transfer.recipient}`, `Source principal: ${s.transfer.amountAtomic} ${from.symbol} atomic (${from.decimals} decimals)`,
      `Quoted destination output: ${s.transfer.quoted_output_atomic} ${to.symbol} atomic`, `Maximum slippage: ${s.transfer.slippageBps} basis points`,
      `Minimum destination output: ${s.transfer.minimum_output_atomic} ${to.symbol} atomic`, `Maximum ${from.symbol} loss including fees/slippage: ${s.transfer.maxRouteFeeAtomic} atomic`,
      `Token loss bound at this route: ${s.fees.token_loss_bound_atomic} ${from.symbol} atomic`,
      `Unitemized protocol fee: ${s.fees.implicit_protocol_token_fee_atomic} ${from.symbol} atomic`,
      `Aggregate source native debit cap: ${s.transfer.maxNativeDebitWei} wei${native ? " (fees only; the native principal is bound by the amount)" : ""}`,
      `Allowance at prepare: ${s.transfer.allowance_atomic_at_prepare} atomic`, `Spender: ${s.transfer.spender}`,
      ...(native ? ["Native principal: sent as the bridge transaction value; no approval effect; approval cap 0."]
        : ["A separate included approval costs gas even if the bridge cannot proceed.",
          ...(from.approval === "zero_first" ? ["This token approves only from a zero allowance; APN approves exactly the principal and never resets."] : [])]),
      "Base total native fee is checked before sending; L1/operator fees have no transaction-level on-chain cap.",
      ...s.effects.flatMap((e) => [`${e.role}: target ${e.to}; native value ${e.value_atomic} wei; nonce ${e.economics.nonceAtomic}`,
        `${e.role}: gas ceiling ${e.economics.gasLimitAtomic}; maxFeePerGas ${e.economics.maxFeePerGasAtomic}; maxPriorityFeePerGas ${e.economics.maxPriorityFeePerGasAtomic}`,
        `${e.role}: total gas quote ${e.fee_quote.totalQuoteWei} wei; provisional bridge ceiling ${e.gas_ceiling_provisional_at_consent}`]),
      ...s.fees.declared.map((fee) => `Declared fee: ${fee.name}; chain ${fee.chainId}; asset ${fee.asset}; ${fee.amountAtomic} atomic; included ${fee.included}`),
      `Source RPC: ${s.rpc_origins.source}`, `Destination RPC: ${s.rpc_origins.destination}`,
      "After the first send attempt, recovery only observes that exact transaction and never resends it.",
      `Policy: ${s.policy.policy_hash}`, `Fingerprint: ${input.fingerprint}`, `Expires: ${s.expires_at}`];
    try { await exactChainConsent(lines, input.exactPhrase, s.expires_at, this.options); return true; }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode !== "APN_TTY_UNAVAILABLE") return false;
      throw error;
    }
  }
}
