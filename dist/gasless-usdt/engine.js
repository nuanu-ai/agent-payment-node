import { usdtFailure } from "./model.js";
export function assertUsdtFunding(plan, account) {
    if (account.usdtBalanceAtomic < plan.request.grossAtomic)
        usdtFailure("APN_INSUFFICIENT_ASSET", "gasless_usdt_balance_below_gross", `The sender holds ${account.usdtBalanceAtomic} atomic USDT; the transfer needs ${plan.request.grossAtomic}.`);
}
//# sourceMappingURL=engine.js.map