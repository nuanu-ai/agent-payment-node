import { encodeFunctionData, parseAbi } from "viem";
import { hashObject } from "../canonical.js";
import { MM_ZERO_ADDRESS } from "./model.js";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmRequest, mmUint } from "./validation.js";
const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
export function mmEconomics(request) {
    mmRequest(request);
    const gross = mmUint(request.grossAtomic, true), minimum = mmUint(request.minReceivedAtomic, true);
    const maximum = mmUint(request.maxFeeAtomic), cap = maximum < gross - minimum ? maximum : gross - minimum;
    return { gross, cap, initialNet: gross - cap };
}
export function mmQuoteHash(quote) {
    return hashObject({ netAtomic: quote.netAtomic, feeAtomic: quote.feeAtomic,
        feeRecipient: quote.feeRecipient, executions: quote.executions });
}
/** Validate each quote independently; convergence and final G=N+F are separate checks. */
export function mmQuote(value, request, binding, requestedNet, reason = "mm_gasless_quote_invalid") {
    const q = mmExact(value, ["netAtomic", "feeAtomic", "feeRecipient", "executions", "hash"], reason);
    const { row } = mmRegistry(request.chainId), economics = mmEconomics(request);
    const net = mmUint(q.netAtomic, true, reason), fee = mmUint(q.feeAtomic, false, reason);
    if (q.netAtomic !== requestedNet || net > economics.gross || net < mmUint(request.minReceivedAtomic))
        mmFail(reason);
    if (fee > economics.cap)
        mmFail(reason === "mm_gasless_state_corrupt" ? reason : "mm_gasless_fee_cap");
    const feeRecipient = mmCanonicalAddress(q.feeRecipient, reason);
    const excluded = [MM_ZERO_ADDRESS, binding.address, row.token, ...Object.values(row.protocol).map(p => p.address)];
    if (excluded.includes(request.recipient) || excluded.includes(feeRecipient) || feeRecipient === request.recipient)
        mmFail(reason);
    if (!Array.isArray(q.executions) || q.executions.length !== 2)
        mmFail(reason);
    for (let i = 0; i < 2; i++) {
        const e = mmExact(q.executions[i], ["target", "value", "callData"], reason);
        const expected = encodeFunctionData({ abi: transferAbi, functionName: "transfer",
            args: [i === 0 ? request.recipient : feeRecipient, i === 0 ? net : fee] });
        if (mmCanonicalAddress(e.target, reason) !== row.token || e.value !== "0" || mmHex(e.callData, undefined, reason) !== expected)
            mmFail(reason);
    }
    const quote = q;
    if (mmHash(q.hash, reason) !== mmQuoteHash(quote))
        mmFail(reason);
    return quote;
}
export function mmAssertStableQuote(request, quote, reason = "mm_gasless_quote_invalid") {
    if (mmUint(quote.netAtomic, true, reason) + mmUint(quote.feeAtomic, false, reason) !== mmUint(request.grossAtomic, true, reason))
        mmFail(reason);
}
export function mmPolicyHash(profileHash, binding, request) {
    return hashObject({ purpose: "apn.metamask-gasless.policy.v1", profileHash, binding,
        chainId: request.chainId, token: mmRegistry(request.chainId).row.token, recipient: request.recipient,
        grossAtomic: request.grossAtomic, maxFeeAtomic: request.maxFeeAtomic, minReceivedAtomic: request.minReceivedAtomic });
}
export function mmAssertIntentEconomics(intent, profileHash) {
    const r = mmRequest(intent.request, "mm_gasless_state_corrupt");
    const deployment = mmRegistry(r.chainId);
    if (intent.token !== deployment.row.token || intent.decimals !== 6 ||
        intent.deploymentEvidenceHash !== deployment.deploymentEvidenceHash ||
        intent.policyHash !== mmPolicyHash(profileHash, intent.binding, r))
        mmFail("mm_gasless_state_corrupt");
    mmQuote(intent.quote, r, intent.binding, intent.quote.netAtomic, "mm_gasless_state_corrupt");
    mmAssertStableQuote(r, intent.quote, "mm_gasless_state_corrupt");
}
//# sourceMappingURL=economics.js.map