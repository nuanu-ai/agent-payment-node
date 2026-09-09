import { isPlainRecord } from "../../canonical.js";
import { mmAssertProfileBinding, mmBinding, mmPrivateHash } from "../identity.js";
import { mmAssertStableQuote, mmQuote, mmQuoteHash } from "../economics.js";
import { mmRegistry } from "../registry.js";
import { MM_REASON_CODES, mmFail } from "../reasons.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmAddress, mmCanonicalAddress, mmChain, mmExact, mmHash, mmHex, mmIso, mmRequest, mmUint, mmUuid } from "../validation.js";
export const MM_HELPER_VERSION = "apn.metamask-gasless-helper.v1";
export function helperRequest(value) {
    if (!isPlainRecord(value) || value.version !== MM_HELPER_VERSION || typeof value.mode !== "string")
        mmFail("mm_gasless_input");
    if (value.mode === "inspect") {
        const r = mmExact(value, ["version", "mode", "expected"], "mm_gasless_input");
        return { version: MM_HELPER_VERSION, mode: "inspect", expected: profileIdentity(r.expected) };
    }
    if (value.mode === "quote") {
        const r = mmExact(value, ["version", "mode", "input"], "mm_gasless_input");
        return { version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(r.input) };
    }
    if (value.mode === "buildUnsigned") {
        const r = mmExact(value, ["version", "mode", "input"], "mm_gasless_input");
        return { version: MM_HELPER_VERSION, mode: "buildUnsigned", input: unsignedInput(r.input) };
    }
    if (value.mode === "submit" || value.mode === "observe") {
        const r = mmExact(value, ["version", "mode", "intent"], "mm_gasless_input");
        return { version: MM_HELPER_VERSION, mode: value.mode, intent: intent(r.intent) };
    }
    return mmFail("mm_gasless_input");
}
export function helperResponse(value, request) {
    if (!isPlainRecord(value) || value.version !== MM_HELPER_VERSION || typeof value.ok !== "boolean")
        mmFail(responseReason(request.mode));
    if (value.ok === false) {
        const r = mmExact(value, ["version", "ok", "failure"], responseReason(request.mode));
        const f = mmExact(r.failure, ["code", "reason"], responseReason(request.mode));
        if (typeof f.reason !== "string" || !Object.hasOwn(MM_REASON_CODES, f.reason) || f.reason === "mm_gasless_success" ||
            MM_REASON_CODES[f.reason] !== f.code)
            mmFail(responseReason(request.mode));
        return value;
    }
    const r = mmExact(value, ["version", "ok", "result"], responseReason(request.mode));
    if (request.mode === "inspect")
        mmAssertProfileBinding(mmBinding(r.result, responseReason(request.mode)), request.expected);
    else if (request.mode === "quote")
        quoteOutput(r.result, request.input);
    else if (request.mode === "buildUnsigned")
        mmValidateUnsigned(r.result, request.input, responseReason(request.mode));
    else
        observation(r.result, request.intent);
    return value;
}
function responseReason(mode) {
    return mode === "submit" ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable";
}
function profileIdentity(value) {
    const p = mmExact(value, ["profile", "profileHash", "address", "accountBindingHash", "capabilityHash", "revision"], "mm_gasless_input");
    if (typeof p.profile !== "string" || p.profile.length < 1 || p.profile.length > 128 ||
        !Number.isSafeInteger(p.revision) || Number(p.revision) < 1)
        mmFail("mm_gasless_input");
    mmHash(p.profileHash, "mm_gasless_input");
    mmCanonicalAddress(p.address, "mm_gasless_input");
    mmHash(p.accountBindingHash, "mm_gasless_input");
    mmHash(p.capabilityHash, "mm_gasless_input");
    return p;
}
function quoteInput(value) {
    const q = mmExact(value, ["binding", "chainId", "token", "recipient", "netAtomic", "rpcUrl"], "mm_gasless_input");
    mmBinding(q.binding, "mm_gasless_input");
    mmChain(q.chainId);
    mmCanonicalAddress(q.token, "mm_gasless_input");
    mmCanonicalAddress(q.recipient, "mm_gasless_input");
    mmUint(q.netAtomic, true, "mm_gasless_input");
    if (typeof q.rpcUrl !== "string" || q.rpcUrl.length > 2048)
        mmFail("mm_gasless_input");
    return q;
}
function executions(value, reason) {
    if (!Array.isArray(value) || value.length !== 2)
        mmFail(reason);
    for (const item of value) {
        const e = mmExact(item, ["target", "value", "callData"], reason);
        mmCanonicalAddress(e.target, reason);
        mmUint(e.value, false, reason);
        mmHex(e.callData, undefined, reason);
    }
}
function unsignedInput(value) {
    const u = mmExact(value, ["owner", "chainId", "executions"], "mm_gasless_input");
    mmCanonicalAddress(u.owner, "mm_gasless_input");
    mmChain(u.chainId);
    executions(u.executions, "mm_gasless_input");
    return u;
}
function quoteResult(value) {
    const q = mmExact(value, ["netAtomic", "feeAtomic", "feeRecipient", "executions", "hash"], "mm_gasless_provider_unavailable");
    mmUint(q.netAtomic, true, "mm_gasless_provider_unavailable");
    mmUint(q.feeAtomic, false, "mm_gasless_provider_unavailable");
    mmCanonicalAddress(q.feeRecipient, "mm_gasless_provider_unavailable");
    executions(q.executions, "mm_gasless_provider_unavailable");
    mmHash(q.hash, "mm_gasless_provider_unavailable");
    return q;
}
function quoteOutput(value, input) {
    const quote = quoteResult(value);
    if (quote.netAtomic !== input.netAtomic || quote.hash !== mmQuoteHash(quote) || quote.executions.some((execution) => execution.target !== input.token || execution.value !== "0"))
        mmFail("mm_gasless_provider_unavailable");
    const gross = (mmUint(quote.netAtomic, true, "mm_gasless_provider_unavailable") +
        mmUint(quote.feeAtomic, false, "mm_gasless_provider_unavailable")).toString();
    return mmQuote(quote, { chainId: input.chainId, recipient: input.recipient, grossAtomic: gross,
        maxFeeAtomic: quote.feeAtomic, minReceivedAtomic: quote.netAtomic }, input.binding, quote.netAtomic, "mm_gasless_provider_unavailable");
}
function intent(value) {
    const keys = ["profile", "request", "binding", "token", "decimals", "deploymentEvidenceHash", "initialSnapshot", "quote",
        "requestId", "preparedAt", "expiresAt", "policyHash", "unsignedDelegation", "delegationHash", "signingDigest", "relayTo", "mode"];
    const i = mmExact(value, keys, "mm_gasless_state_corrupt");
    if (typeof i.profile !== "string" || i.profile.length < 1 || i.profile.length > 128 || i.decimals !== 6)
        mmFail("mm_gasless_state_corrupt");
    const request = mmRequest(i.request, "mm_gasless_state_corrupt"), binding = mmBinding(i.binding, "mm_gasless_state_corrupt");
    mmCanonicalAddress(i.token, "mm_gasless_state_corrupt");
    mmHash(i.deploymentEvidenceHash, "mm_gasless_state_corrupt");
    mmHash(i.policyHash, "mm_gasless_state_corrupt");
    mmUuid(i.requestId, "mm_gasless_state_corrupt");
    mmIso(i.preparedAt, "mm_gasless_state_corrupt");
    mmIso(i.expiresAt, "mm_gasless_state_corrupt");
    const quote = quoteResult(i.quote), typed = i;
    const deployment = mmRegistry(request.chainId);
    if (i.token !== deployment.row.token || i.deploymentEvidenceHash !== deployment.deploymentEvidenceHash)
        mmFail("mm_gasless_state_corrupt");
    mmQuote(quote, request, binding, quote.netAtomic, "mm_gasless_state_corrupt");
    mmAssertStableQuote(request, quote, "mm_gasless_state_corrupt");
    const unsigned = mmValidateUnsigned({ unsignedDelegation: i.unsignedDelegation, delegationHash: i.delegationHash,
        signingDigest: i.signingDigest, relayTo: i.relayTo, mode: i.mode }, { owner: binding.address, chainId: request.chainId, executions: quote.executions }, "mm_gasless_state_corrupt");
    void unsigned;
    snapshot(i.initialSnapshot, request.chainId);
    return typed;
}
function block(value, reason) {
    const b = mmExact(value, ["numberAtomic", "hash", "timestampAtomic"], reason);
    mmUint(b.numberAtomic, false, reason);
    mmHex(b.hash, 32, reason);
    mmUint(b.timestampAtomic, false, reason);
}
function snapshot(value, chainId) {
    const s = mmExact(value, ["chainId", "endpointHash", "endpointOrigin", "observedAt", "safeBlock", "headBlock", "safeState", "headState"], "mm_gasless_state_corrupt");
    if (s.chainId !== chainId || typeof s.endpointOrigin !== "string" || s.endpointOrigin.length > 2048)
        mmFail("mm_gasless_state_corrupt");
    mmHash(s.endpointHash, "mm_gasless_state_corrupt");
    mmIso(s.observedAt, "mm_gasless_state_corrupt");
    block(s.safeBlock, "mm_gasless_state_corrupt");
    block(s.headBlock, "mm_gasless_state_corrupt");
    chainState(s.safeState);
    chainState(s.headState);
}
function chainState(value) {
    const s = mmExact(value, ["protocolCodeHashes", "tokenProxyCodeHash", "tokenImplementationAddress", "tokenImplementationCodeHash",
        "tokenDecimals", "ownerCodeHash", "designation", "usdcBalanceAtomic", "counterAtomic"], "mm_gasless_state_corrupt");
    const hashes = mmExact(s.protocolCodeHashes, ["manager", "delegate", "limitedCalls", "exactBatch"], "mm_gasless_state_corrupt");
    for (const key of ["manager", "delegate", "limitedCalls", "exactBatch"])
        mmHex(hashes[key], 32, "mm_gasless_state_corrupt");
    mmHex(s.tokenProxyCodeHash, 32, "mm_gasless_state_corrupt");
    mmCanonicalAddress(s.tokenImplementationAddress, "mm_gasless_state_corrupt");
    mmHex(s.tokenImplementationCodeHash, 32, "mm_gasless_state_corrupt");
    mmHex(s.ownerCodeHash, 32, "mm_gasless_state_corrupt");
    if (s.tokenDecimals !== 6 || !["empty", "pinned"].includes(String(s.designation)))
        mmFail("mm_gasless_state_corrupt");
    mmUint(s.usdcBalanceAtomic, false, "mm_gasless_state_corrupt");
    mmUint(s.counterAtomic, false, "mm_gasless_state_corrupt");
}
function observation(value, intentValue) {
    const o = mmExact(value, ["observedAt", "requestIdHash", "status", "txHash"], "mm_gasless_provider_unavailable");
    mmIso(o.observedAt, "mm_gasless_provider_unavailable");
    mmHash(o.requestIdHash, "mm_gasless_provider_unavailable");
    if (!["pending", "broadcasted", "confirmed", "failed", "unavailable"].includes(String(o.status)) ||
        (o.txHash !== null && mmHex(o.txHash, 32, "mm_gasless_provider_unavailable") !== o.txHash))
        mmFail("mm_gasless_provider_unavailable");
    mmUuid(intentValue.requestId, "mm_gasless_state_corrupt");
    if (o.requestIdHash !== mmPrivateHash("request-id", intentValue.requestId))
        mmFail("mm_gasless_provider_unavailable");
    return o;
}
//# sourceMappingURL=protocol.js.map