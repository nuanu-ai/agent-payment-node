import { formatUnits } from "viem";
import { ApnError } from "../errors.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { GaslessApprovalPort } from "./ports.js";
import type { publicGaslessOperation } from "./receipt.js";

export class TtyGaslessApproval implements GaslessApprovalPort {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}
  async confirm(input: Parameters<GaslessApprovalPort["confirm"]>[0]): Promise<boolean> {
    const generic = input.summary as Readonly<Record<string, unknown>>;
    if (generic.gasless_provider === "coinbase-agentic-wallet") return await this.confirmCoinbase(input);
    const s = input.summary as ReturnType<typeof publicGaslessOperation>, t = s.transfer;
    // Unit and scale come from the registry row the receipt resolved, never from a symbol baked into this screen.
    const amount = (atomic: string) => `${formatUnits(BigInt(atomic), t.decimals)} ${t.symbol}`;
    const lines = [`Agent Payment Node — transfer with gas paid in ${t.symbol}`, `Profile: ${s.profile}; local software custody`,
      `Chain: eip155:${t.chain_id}`, `${t.symbol} contract: ${t.token}`, `Sender: ${t.sender}`, `Recipient: ${t.recipient}`,
      `Total budget: ${amount(t.gross_atomic)}`, `Recipient receives: ${amount(t.recipient_atomic)}`,
      `Frozen maximum fee: ${amount(t.quoted_fee_budget_atomic)}`, `Your fee limit: ${amount(t.user_max_fee_atomic)}`,
      `Your minimum receipt: ${amount(t.minimum_received_atomic)}`,
      "Unused fee budget remains in your wallet. The sender pays no native gas.",
      `A reverted transfer can still charge the displayed ${t.symbol} fee budget.`,
      `Persistent account delegation: ${s.permission.delegate}; current state: ${s.permission.initial_designation}`,
      `Paymaster permission: ${s.permission.paymaster}, up to ${amount(s.permission.permit_amount_atomic)}`,
      `Current paymaster allowance: ${amount(s.permission.initial_allowance_atomic)}`,
      "The signed permit and operation have no on-chain expiry. Delegation persists after this payment.",
      "Success clears the paymaster allowance. An unresolved failure blocks new transfers from this wallet on this chain until it is reconciled.",
      `RPC: ${s.rpc_origin}`, `Bundler: ${s.bundler_origin}`, `Operation: ${s.operation_id}`,
      `Fingerprint: ${input.fingerprint}`, `Approve before: ${s.expires_at}`];
    try { await exactChainConsent(lines, input.exactPhrase, s.expires_at, this.options); return true; }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode !== "APN_TTY_UNAVAILABLE") return false;
      throw error;
    }
  }
  private async confirmCoinbase(input: Parameters<GaslessApprovalPort["confirm"]>[0]): Promise<boolean> {
    const s = input.summary as any, t = s.transfer, usdc = (atomic: string) => `${formatUnits(BigInt(atomic), 6)} USDC`;
    const lines = ["Agent Payment Node — Coinbase gasless transfer", `Profile: ${s.profile}; provider-owned custody`,
      `Chain: eip155:${t.chain_id}`, `USDC contract: ${t.token}`, `Sender: ${t.sender}`, `Recipient: ${t.recipient}`,
      `Gross debit: ${usdc(t.gross_atomic)}`, `Recipient receives: ${usdc(t.recipient_atomic)}`,
      `Token fee: ${usdc(t.quoted_fee_budget_atomic)}`, `Your maximum token fee: ${usdc(t.user_max_fee_atomic)}`,
      `Your minimum receipt: ${usdc(t.minimum_received_atomic)}`, "Sender native debit: 0 wei.",
      "Gas is sponsored by the external Coinbase CDP paymaster and billed outside this wallet.",
      "Exactly one AWAL send invocation is permitted. APN never retries after dispatch starts.",
      "Another identical external send during observation makes attribution ambiguous.",
      "An ambiguous outcome blocks new transfers from this wallet on Base until canonical positive proof is found.",
      `RPC: ${s.rpc_origin}`, `Safe anchor: ${s.safe_anchor.numberAtomic} (${s.safe_anchor.hash})`,
      `Operation: ${s.operation_id}`, `Fingerprint: ${input.fingerprint}`, `Approve before: ${s.expires_at}`];
    try { await exactChainConsent(lines, input.exactPhrase, s.expires_at, this.options, 256); return true; }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode !== "APN_TTY_UNAVAILABLE") return false;
      throw error;
    }
  }
}
