import { USDT_GASLESS } from "./model.js";
/** Six-decimal display of an atomic USDT amount; exact, never rounded. */
export function usdtDisplay(atomic) {
    const value = BigInt(atomic), scale = 10n ** BigInt(USDT_GASLESS.decimals);
    const whole = value / scale, fraction = (value % scale).toString().padStart(USDT_GASLESS.decimals, "0").replace(/0+$/u, "");
    return `${whole}${fraction === "" ? "" : `.${fraction}`} ${USDT_GASLESS.symbol}`;
}
/**
 * The approval screen: gross, fee budget, net and the owner's caps, with the sponsor's identity and the one allowance
 * the batch leaves behind. The human approves exactly these values; the signature later commits to them.
 */
export function usdtApprovalScreen(plan, admission, firstUse) {
    return [
        `Network: ${USDT_GASLESS.network} (chain ${USDT_GASLESS.chainId})`,
        `Token: ${USDT_GASLESS.symbol} ${USDT_GASLESS.token}`,
        `From: ${plan.request.sender}`,
        `To: ${plan.request.recipient}`,
        `Gross (total sender debit at most): ${usdtDisplay(plan.request.grossAtomic)} (${plan.request.grossAtomic} atomic)`,
        `Fee cap (allowance granted to the sponsor): ${usdtDisplay(plan.feeCapAtomic)} (${plan.feeCapAtomic} atomic)`,
        `Net to recipient: ${usdtDisplay(plan.netAtomic)} (${plan.netAtomic} atomic)`,
        `Current worst-case fee quote: ${usdtDisplay(plan.quotedFeeAtomic)} (${plan.quotedFeeAtomic} atomic)`,
        `Sponsor: Pimlico ERC-20 paymaster ${USDT_GASLESS.paymaster}, fee paid in ${USDT_GASLESS.symbol} to ${USDT_GASLESS.treasury}`,
        `Owner caps (rail gasless, policy revision ${admission.policyRevision}): per operation ${usdtDisplay(admission.maximumPerTransferAtomic)}, ` +
            `daily ${usdtDisplay(admission.dailyLimitAtomic)}, used today ${usdtDisplay(admission.dailyUsageAtomic)}`,
        ...(firstUse ? [`First use: delegates ${plan.request.sender} to ${USDT_GASLESS.delegate} (EIP-7702); the delegation persists.`] : []),
        `After the transfer the unused fee (fee cap minus actual fee) stays approved to the sponsor until your next USDT gasless transfer resets it.`,
    ];
}
//# sourceMappingURL=approval.js.map