import { publicMetaMaskGaslessOperation } from "./journal/receipt.js";
import { mmRegistry } from "./registry.js";
import { mmFormat } from "./validation.js";
export function metaMaskGaslessApprovalPhrase(op) {
    return `APPROVE GASLESS ${op.operationId} ${op.fingerprint}`;
}
export function metaMaskGaslessApprovalSummary(op, now) {
    return { ...publicMetaMaskGaslessOperation(op), network: mmRegistry(op.intent.request.chainId).row.network,
        gross_usdc: mmFormat(op.intent.request.grossAtomic), recipient_usdc: mmFormat(op.intent.quote.netAtomic),
        fee_usdc: mmFormat(op.intent.quote.feeAtomic), maximum_fee_usdc: mmFormat(op.intent.request.maxFeeAtomic),
        minimum_received_usdc: mmFormat(op.intent.request.minReceivedAtomic), remaining_ms: Math.max(0, Date.parse(op.intent.expiresAt) - now),
        authorization: "The provider signs and executes one exact USDC batch. APN requires no sender native prefunding.",
        outer_gas_payer: "Provider relay; exact address pending independent transaction evidence.",
        persistent_effects: "The provider may install or preserve the pinned EIP-7702 designation on this same address. It can remain after delivery.",
        permission_warning: "The root permission allows one successful exact batch without an onchain expiry. The APN deadline only limits first dispatch. Timeout, revert or later expiry does not revoke it or guarantee no payment.",
    };
}
//# sourceMappingURL=approval.js.map