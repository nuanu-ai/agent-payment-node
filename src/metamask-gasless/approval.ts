import { mmActualGross } from "./economics.js";
import { approvalCode } from "../approval-code.js";
import { publicMetaMaskGaslessOperation } from "./journal/receipt.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { mmRegistry } from "./registry.js";
import { mmFormat } from "./validation.js";

export function metaMaskGaslessApprovalPhrase(op: MetaMaskGaslessOperationRecord): string {
  return approvalCode("gasless", op.operationId, op.fingerprint);
}
export function metaMaskGaslessApprovalSummary(op: MetaMaskGaslessOperationRecord, now: number): Readonly<Record<string, unknown>> {
  return { ...publicMetaMaskGaslessOperation(op), network: mmRegistry(op.intent.request.chainId).row.network,
    ...(op.intent.request.fixedNet ? { requested_fixed_net_usdc: mmFormat(op.intent.request.fixedNet.netAtomic),
      maximum_gross_usdc: mmFormat(op.intent.request.fixedNet.maxGrossAtomic) } : {}),
    gross_usdc: mmFormat(mmActualGross(op.intent.quote)), recipient_usdc: mmFormat(op.intent.quote.netAtomic),
    fee_usdc: mmFormat(op.intent.quote.feeAtomic), maximum_fee_usdc: mmFormat(op.intent.request.maxFeeAtomic),
    minimum_received_usdc: mmFormat(op.intent.request.minReceivedAtomic), remaining_ms: Math.max(0, Date.parse(op.intent.expiresAt) - now),
    authorization: op.intent.request.fixedNet ? "The provider signs one exact USDC batch priced when you confirm. The recipient receives exactly the fixed net amount. The actual debit is net plus fee and cannot exceed the maximum gross or maximum fee. APN requires no sender native prefunding." : "The provider signs and executes one exact USDC batch, priced when you confirm: the fee may differ from the exact fee above but can never exceed your fee ceiling, and the recipient can never receive less than your minimum. APN requires no sender native prefunding.",
    outer_gas_payer: "Provider relay; exact address pending independent transaction evidence.",
    persistent_effects: "The provider may install or preserve the pinned EIP-7702 designation on this same address. It can remain after delivery.",
    permission_warning: "The root permission allows one successful exact batch without an onchain expiry. The APN deadline only limits first dispatch. Timeout, revert or later expiry does not revoke it or guarantee no payment.",
  };
}
