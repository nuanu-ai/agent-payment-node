import { USDT_GASLESS, usdtFailure } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { verifyUsdtReceipt } from "./receipt.js";
import { usdtUserOperation, usdtUserOperationHash } from "./userop.js";
/** Structurally valid, recoverable and never the owner's: the sponsor simulates with it and the account rejects it. */
export const USDT_ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c`;
const STUB_AUTHORIZATION_WORD = `0x${"11".repeat(32)}`;
/** Prepare: the exact token quote and fee plan. Reads the sponsor and pins only; no key, no signature. */
export async function quoteUsdtGasless(ports, request) {
    await ports.chain.verifyPins();
    const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
    const { fast } = validateUsdtGasPrice(await ports.sponsor.gasPrice());
    return planUsdtTransfer(request, quote, fast);
}
/** Economic check after the quote: the sender must hold the gross, because N + A can reach N + F. */
export function assertUsdtFunding(plan, account) {
    if (account.usdtBalanceAtomic < plan.request.grossAtomic) {
        usdtFailure("APN_INSUFFICIENT_ASSET", "gasless_usdt_balance_below_gross", `The sender holds ${account.usdtBalanceAtomic} atomic USDT; the transfer needs ${plan.request.grossAtomic}.`);
    }
}
/**
 * The sponsor's signed payload for this exact operation, requested with a structural signature. On a first use the
 * authorization is a stub with the account's real nonce; the sponsor signs over the delegate, not the tuple. This is the
 * last step before any signature and is what the read-only rehearsal runs.
 */
export async function sponsorUsdtOperation(sponsor, plan, account, nowSeconds) {
    const stub = account.delegation === "empty" ? stubAuthorization(account.eoaNonce) : null;
    const draft = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, paymasterData: "0x",
        signature: USDT_ESTIMATE_SIGNATURE, authorization: stub });
    const result = await sponsor.paymasterData(draft);
    validateUsdtPaymasterData(result, plan, nowSeconds);
    return result.paymasterData.toLowerCase();
}
/**
 * After the foreground approval and the allowlist reservation: fresh account state, sponsor data, then the signatures,
 * then the durable marker, then exactly one send. A failed marker write sends nothing; a lost send response is recorded
 * as unacknowledged and is only ever observed, never retried.
 */
export async function approveAndSendUsdtGasless(ports, plan, nowSeconds) {
    await ports.chain.verifyPins();
    const account = await ports.chain.account(plan.request.sender);
    assertUsdtFunding(plan, account);
    const paymasterData = await sponsorUsdtOperation(ports.sponsor, plan, account, nowSeconds);
    const authorization = account.delegation === "empty" ? await ports.signer.authorize(account.eoaNonce) : null;
    if (authorization !== null && BigInt(authorization.nonce) !== account.eoaNonce) {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_authorization_nonce");
    }
    const unsigned = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, paymasterData,
        signature: USDT_ESTIMATE_SIGNATURE, authorization });
    const userOpHash = usdtUserOperationHash(unsigned);
    const signature = await ports.signer.signUserOperation(userOpHash);
    const op = { ...unsigned, signature };
    await ports.journal.markSending(userOpHash);
    let answer;
    try {
        answer = await ports.sponsor.send(op);
    }
    catch {
        await ports.journal.markSent(userOpHash, "unacknowledged");
        return { state: "send_unacknowledged", userOpHash };
    }
    if (typeof answer !== "string" || answer.toLowerCase() !== userOpHash.toLowerCase()) {
        await ports.journal.markSent(userOpHash, "unacknowledged");
        return { state: "send_unacknowledged", userOpHash };
    }
    await ports.journal.markSent(userOpHash, "accepted");
    return { state: "sent", userOpHash };
}
/** Status observes only: one canonical receipt read and its proof. It never signs, discloses or sends. */
export async function observeUsdtGasless(chain, plan, userOpHash) {
    const receipt = await chain.receiptFor(userOpHash);
    if (receipt === null)
        return { state: "pending" };
    return { state: "completed", settlement: verifyUsdtReceipt(plan, userOpHash, receipt) };
}
function stubAuthorization(nonce) {
    return { chainId: "0x1", address: USDT_GASLESS.delegate, nonce: `0x${nonce.toString(16)}`, yParity: "0x0",
        r: STUB_AUTHORIZATION_WORD, s: STUB_AUTHORIZATION_WORD };
}
//# sourceMappingURL=engine.js.map