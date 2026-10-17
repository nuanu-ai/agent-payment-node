import { usdtFailure, type UsdtTransferPlan } from "./model.js";
import type { UsdtUserOperation } from "./userop.js";

/** Read-only sponsor surface. There is deliberately no signing or submission method. */
export interface UsdtSponsorPort {
  tokenQuote(): Promise<unknown>;
  gasPrice(): Promise<unknown>;
  paymasterData(op: UsdtUserOperation): Promise<unknown>;
}
export interface UsdtAccountState {
  readonly usdtBalanceAtomic: bigint; readonly entryPointNonce: bigint; readonly eoaNonce: bigint; readonly delegation: "empty" | "expected";
}

export function assertUsdtFunding(plan: UsdtTransferPlan, account: UsdtAccountState): void {
  if (account.usdtBalanceAtomic < plan.request.grossAtomic) usdtFailure("APN_INSUFFICIENT_ASSET", "gasless_usdt_balance_below_gross",
    `The sender holds ${account.usdtBalanceAtomic} atomic USDT; the transfer needs ${plan.request.grossAtomic}.`);
}

