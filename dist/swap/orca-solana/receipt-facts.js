import { ApnError } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord } from "../../solana/rpc.js";
import { isOrcaTokenPlan, orcaPlanSides } from "./instructions.js";
import { orcaTokenBalance } from "./receipt.js";
export function orcaFactsAccounts(record, material) {
    const plan = material.execution.plan, sides = orcaPlanSides(plan), native = !isOrcaTokenPlan(plan);
    return { owner: record.quote.account, native, input: native ? sides.pool.vaultA : sides.source, destination: sides.destination,
        mintA: sides.pool.mintA, decimalsA: sides.pool.decimalsA, mintB: sides.pool.mintB, decimalsB: sides.pool.decimalsB };
}
/**
 * The economics of an Orca swap its record proved finalized, from that transaction's own finalized record (read once):
 * the fee and the payer's SOL delta, the owner's output-token delta, the input (the owner's source-token delta, or for SOL
 * what the pool's wSOL vault received) and the rent a new destination account holds. The transaction must carry the
 * record's own signature, be paid by the record's account and have the outcome the record holds.
 */
export function orcaEconomicsFromTransaction(record, accounts, responseValue) {
    const response = rpcRecord(responseValue), meta = rpcRecord(response.meta), transaction = rpcRecord(response.transaction);
    const signatures = rpcArray(transaction.signatures, 8), keys = rpcArray(rpcRecord(transaction.message).accountKeys, 256)
        .map(key => typeof key === "string" ? key : rpcRecord(key).pubkey);
    const failed = meta.err !== null && meta.err !== undefined, fee = rpcAtomic(meta.fee);
    if (signatures[0] !== record.receiptProof?.transactionHash || rpcAtomic(response.version) !== 0n || keys[0] !== accounts.owner ||
        failed === (record.state === "finalized") || !["finalized", "failed_confirmed_revert"].includes(record.state))
        binding();
    if (failed)
        return { inputAtomic: "0", outputAtomic: null, networkFeeAtomic: fee.toString(), nativeDebitAtomic: fee.toString() };
    const pre = rpcArray(meta.preBalances, 256).map(rpcAtomic), post = rpcArray(meta.postBalances, 256).map(rpcAtomic);
    const index = (key) => { const found = keys.indexOf(key); if (found < 0 || pre[found] === undefined || post[found] === undefined)
        binding(); return found; };
    const output = index(accounts.destination), input = index(accounts.input);
    const received = orcaTokenBalance(meta.postTokenBalances, output, accounts.mintB, accounts.decimalsB, accounts.owner, false) -
        orcaTokenBalance(meta.preTokenBalances, output, accounts.mintB, accounts.decimalsB, accounts.owner, true);
    const moved = accounts.native ? post[input] - pre[input] : orcaTokenBalance(meta.preTokenBalances, input, accounts.mintA, accounts.decimalsA, accounts.owner, false) -
        orcaTokenBalance(meta.postTokenBalances, input, accounts.mintA, accounts.decimalsA, accounts.owner, false);
    const rent = post[output] - pre[output], spent = pre[0] - post[0];
    if (received < BigInt(record.quote.minimumOutputAtomic) || moved !== BigInt(record.quote.inputAmountAtomic) || rent < 0n || spent < fee)
        binding();
    return { inputAtomic: moved.toString(), outputAtomic: received.toString(), networkFeeAtomic: fee.toString(),
        nativeDebitAtomic: spent.toString(), accountRentAtomic: rent.toString() };
}
function binding() {
    throw new ApnError("APN_RPC_PROTOCOL", "The finalized transaction read for the swap economics is not the one this record proved.", { reason: "receipt_facts_binding" });
}
//# sourceMappingURL=receipt-facts.js.map