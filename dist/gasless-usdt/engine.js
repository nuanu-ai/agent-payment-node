import { USDT_GASLESS, usdtFailure } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { verifyUsdtReceipt } from "./receipt.js";
import { usdtUserOperation } from "./userop.js";
export async function quoteUsdtGasless(ports, request) {
    await ports.chain.verifyPins();
    const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
    const { fast } = validateUsdtGasPrice(await ports.sponsor.gasPrice());
    return planUsdtTransfer(request, quote, fast);
}
export function assertUsdtFunding(plan, account) {
    if (account.usdtBalanceAtomic < plan.request.grossAtomic)
        usdtFailure("APN_INSUFFICIENT_ASSET", "gasless_usdt_balance_below_gross", `The sender holds ${account.usdtBalanceAtomic} atomic USDT; the transfer needs ${plan.request.grossAtomic}.`);
}
const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c`;
const STUB_WORD = `0x${"11".repeat(32)}`;
function stubAuthorization(nonce) {
    return { chainId: "0x1", address: USDT_GASLESS.delegate, nonce: `0x${nonce.toString(16)}`, yParity: "0x0", r: STUB_WORD, s: STUB_WORD };
}
/** Requests and validates sponsor data against the exact unsigned operation. No key or effect is reachable here. */
export async function sponsorUsdtOperation(sponsor, plan, account, nowSeconds) {
    const authorization = account.delegation === "empty" ? stubAuthorization(account.eoaNonce) : null;
    const draft = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData: "0x", paymasterData: "0x", signature: ESTIMATE_SIGNATURE, authorization });
    const result = await sponsor.paymasterData(draft);
    validateUsdtPaymasterData(result, plan, nowSeconds);
    return result.paymasterData.toLowerCase();
}
export async function observeUsdtGasless(ports, plan, userOpHash) {
    const locator = await ports.sponsor.receiptLocator(userOpHash);
    if (locator === null)
        return { state: "pending" };
    const receipt = await ports.chain.receiptAt(locator);
    if (receipt === null)
        return { state: "pending" };
    return { state: "completed", settlement: verifyUsdtReceipt(plan, userOpHash, receipt) };
}
//# sourceMappingURL=engine.js.map