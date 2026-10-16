import { ETH_DECIMALS, USDC_DECIMALS } from "./constants.js";
import { formatAtomic, parseAtomic } from "./money.js";
const WARNING = "Only fund an amount you can afford to lose; this local-software wallet has no backup or hardware protection.";
const UNCONFIGURED_ACTION = "No owner profile policy is configured, so APN cannot assess balance limits and unattended x402 is blocked. " +
    "Configure it with apn wallet policy set; fund this disposable wallet manually with only a small amount of Base ETH for gas and Base USDC for the payment.";
const USDC_TERMS = {
    label: "Base USDC",
    purpose: " for payments",
    unit: "atomic units",
    symbol: "USDC",
    decimals: USDC_DECIMALS,
    atLimitEffect: "; any further inbound USDC blocks new unattended x402",
    overEffect: "new unattended x402 is blocked until the owner reduces the excess manually",
};
const ETH_TERMS = {
    label: "Base ETH",
    purpose: " for gas",
    unit: "wei",
    symbol: "ETH",
    decimals: ETH_DECIMALS,
    atLimitEffect: "",
    overEffect: "unattended x402 is gated by the USDC limit only, so this ETH excess does not block it",
};
/** Posture-aware funding advice: never suggests adding an asset that is at or above its owner limit. */
export function walletFundingGuidance(usdcAtomic, ethAtomic, policy, postureActions) {
    if (policy === null) {
        return {
            funding_guidance: { action: UNCONFIGURED_ACTION, warning: WARNING },
            next_actions: [...postureActions, "Fund with low value only", "Re-run apn wallet balance"],
        };
    }
    const usdc = assetAdvice(parseAtomic(usdcAtomic), policy.maxBalanceUsdcAtomic, USDC_TERMS);
    const eth = assetAdvice(parseAtomic(ethAtomic), policy.maxBalanceEthWei, ETH_TERMS);
    const fundAction = usdc.fundable && eth.fundable ? ["Fund with low value only"]
        : usdc.fundable ? ["Fund only Base USDC, with low value only"]
            : eth.fundable ? ["Fund only Base ETH for gas, with low value only"] : [];
    return {
        funding_guidance: { action: `${usdc.sentence} ${eth.sentence}`, warning: WARNING },
        next_actions: [...postureActions, ...fundAction, "Re-run apn wallet balance"],
    };
}
function assetAdvice(balance, limitInput, terms) {
    const { label, purpose, unit } = terms;
    if (limitInput === undefined) {
        return {
            fundable: true,
            sentence: `Fund ${label}${purpose} manually with a small amount only; no owner ${terms.symbol} balance limit is configured.`,
        };
    }
    const limit = BigInt(limitInput);
    if (balance < limit) {
        return {
            fundable: true,
            sentence: `Fund ${label}${purpose} manually with a small amount only: at most ${amount(limit - balance, terms)} more keeps it within the owner limit of ${limit} ${unit}.`,
        };
    }
    if (balance === limit) {
        return {
            fundable: false,
            sentence: `Do not add ${label}: the balance is exactly at the owner limit of ${limit} ${unit}${terms.atLimitEffect}.`,
        };
    }
    return {
        fundable: false,
        sentence: `Do not add ${label}: the balance exceeds the owner limit of ${limit} ${unit} by ${amount(balance - limit, terms)}; ${terms.overEffect}.`,
    };
}
function amount(value, terms) {
    return `${value} ${terms.unit} (${formatAtomic(value.toString(), terms.decimals)} ${terms.symbol})`;
}
//# sourceMappingURL=funding-guidance.js.map