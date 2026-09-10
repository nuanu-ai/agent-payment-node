import type { Address } from "./model.js";
import { exactChainConsent, TTY_APPROVAL_DEADLINE_MS, type TtyTransferApprovalOptions } from "./tty-approval.js";

export interface OperationAbandonIntent {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly profile: string;
  readonly providerId: string;
  readonly walletAddress: Address;
  readonly recipient: Address;
  readonly amountAtomic: string;
  readonly amountDecimal: string;
}

export interface OperationAbandonApprovalPort {
  approve(intent: OperationAbandonIntent): Promise<void>;
}

export class TtyOperationAbandonApproval implements OperationAbandonApprovalPort {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}

  async approve(intent: OperationAbandonIntent): Promise<void> {
    await exactChainConsent([
      "Agent Payment Node unknown-effect abandonment",
      `Operation: ${intent.operationId}`,
      `Fingerprint: ${intent.fingerprint}`,
      `Profile: ${intent.profile}`,
      `Provider: ${intent.providerId}`,
      "Chain: Base (8453)",
      "Asset: canonical Base USDC",
      `Sender: ${intent.walletAddress}`,
      `Recipient: ${intent.recipient}`,
      `Amount: ${intent.amountDecimal} USDC (${intent.amountAtomic} atomic)`,
      "Financial outcome: UNKNOWN. The provider may already have sent this transfer.",
      "This administrative action does not prove success, failure, cancellation, refund or no effect.",
      "The original operation will never be submitted again; a new operation has independent risk.",
    ], operationAbandonPhrase(intent.fingerprint), new Date(Date.now() + TTY_APPROVAL_DEADLINE_MS).toISOString(), this.options);
  }
}

export function operationAbandonPhrase(fingerprint: string): string {
  return `ABANDON APN UNKNOWN ${fingerprint.slice(-16)}`;
}
