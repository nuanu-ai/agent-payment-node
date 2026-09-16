import { keccak256 } from "viem";
import { hashObject } from "../../canonical.js";
import { MM_MIN_REMAINING_MS, MM_TTL_MS, MM_ZERO_ADDRESS } from "../model.js";
import { mmAssertIntentEconomics, mmRepriceWithinCap } from "../economics.js";
import { mmBinding, mmPrivateHash } from "../identity.js";
import { mmRegistry } from "../registry.js";
import { MM_REASON_CODES, mmFail } from "../reasons.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmIso, mmRequest, mmSame, mmUint, mmUuid } from "../validation.js";
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const EMPTY_CODE_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const STATES = ["awaiting_approval", "execution_pending", "dispatch_pending",
    "submitted_pending", "unknown_finality", "failed_effects_pending", "completed", "failed_before_effect", "abandoned_unknown"];
const MUTABLE_KEYS = ["state", "approval", "submissionAttempts", "dispatchStartedAt", "dispatch",
    "providerObservation", "cursor", "observation", "settlement", "failure"];
function corrupt() { return mmFail("mm_gasless_state_corrupt"); }
function time(value) { return Date.parse(mmIso(value)); }
function recordMutable(value) {
    return Object.fromEntries(MUTABLE_KEYS.map(key => [key, value[key]]));
}
function origin(value) {
    if (typeof value !== "string" || value.length > 256)
        return corrupt();
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password)
            corrupt();
    }
    catch {
        corrupt();
    }
    return value;
}
function block(value) {
    const b = mmExact(value, ["numberAtomic", "hash", "timestampAtomic"]);
    mmUint(b.numberAtomic);
    mmHex(b.hash, 32);
    mmUint(b.timestampAtomic);
    return b;
}
function blockOrder(first, second) {
    if (BigInt(second.numberAtomic) < BigInt(first.numberAtomic) ||
        (second.numberAtomic === first.numberAtomic && !mmSame(first, second)))
        corrupt();
}
function chainState(value, chainId) {
    const s = mmExact(value, ["protocolCodeHashes", "tokenProxyCodeHash", "tokenImplementationAddress",
        "tokenImplementationCodeHash", "tokenDecimals", "ownerCodeHash", "designation", "usdcBalanceAtomic", "counterAtomic"]);
    const codes = mmExact(s.protocolCodeHashes, ["manager", "delegate", "limitedCalls", "exactBatch"]);
    const row = mmRegistry(chainId).row;
    for (const name of ["manager", "delegate", "limitedCalls", "exactBatch"]) {
        if (mmHex(codes[name], 32) !== row.protocol[name].codeHash)
            corrupt();
    }
    if (mmHex(s.tokenProxyCodeHash, 32) !== row.tokenProxyCodeHash ||
        mmCanonicalAddress(s.tokenImplementationAddress) !== row.tokenImplementationAddress ||
        mmHex(s.tokenImplementationCodeHash, 32) !== row.tokenImplementationCodeHash || s.tokenDecimals !== 6 ||
        !["empty", "pinned"].includes(s.designation) || mmUint(s.counterAtomic).toString() !== "0")
        corrupt();
    const ownerCodeHash = mmHex(s.ownerCodeHash, 32);
    const pinnedOwnerCodeHash = keccak256(`0xef0100${row.protocol.delegate.address.slice(2)}`);
    if (ownerCodeHash !== (s.designation === "pinned" ? pinnedOwnerCodeHash : EMPTY_CODE_HASH))
        corrupt();
    mmUint(s.usdcBalanceAtomic);
    return s;
}
function snapshot(value, chainId) {
    const s = mmExact(value, ["chainId", "endpointHash", "endpointOrigin", "observedAt", "safeBlock", "headBlock",
        "safeState", "headState"]);
    if (s.chainId !== chainId)
        corrupt();
    mmHash(s.endpointHash);
    origin(s.endpointOrigin);
    mmIso(s.observedAt);
    const safeBlock = block(s.safeBlock), headBlock = block(s.headBlock);
    blockOrder(safeBlock, headBlock);
    chainState(s.safeState, chainId);
    chainState(s.headState, chainId);
    return s;
}
export function mmJournalIntent(value, profileHash) {
    const i = mmExact(value, ["profile", "request", "binding", "token", "decimals", "deploymentEvidenceHash",
        "initialSnapshot", "quote", "requestId", "unsignedDelegation", "delegationHash", "signingDigest", "relayTo",
        "mode", "preparedAt", "expiresAt", "policyHash"]);
    if (typeof i.profile !== "string" || !PROFILE.test(i.profile))
        corrupt();
    const request = mmRequest(i.request, "mm_gasless_state_corrupt"), binding = mmBinding(i.binding, "mm_gasless_state_corrupt");
    mmCanonicalAddress(i.token);
    mmHash(i.deploymentEvidenceHash);
    mmUuid(i.requestId);
    const initial = snapshot(i.initialSnapshot, request.chainId);
    const preparedAt = mmIso(i.preparedAt), expiresAt = mmIso(i.expiresAt);
    if (time(expiresAt) - time(preparedAt) !== MM_TTL_MS || time(initial.observedAt) > time(preparedAt))
        corrupt();
    const gross = mmUint(request.grossAtomic, true, "mm_gasless_state_corrupt");
    if (mmUint(initial.safeState.usdcBalanceAtomic, false, "mm_gasless_state_corrupt") < gross ||
        mmUint(initial.headState.usdcBalanceAtomic, false, "mm_gasless_state_corrupt") < gross)
        corrupt();
    mmHash(i.policyHash);
    mmHex(i.delegationHash, 32);
    mmHex(i.signingDigest, 32);
    mmCanonicalAddress(i.relayTo);
    mmHex(i.mode, 32);
    const intent = i;
    mmAssertIntentEconomics(intent, profileHash);
    mmValidateUnsigned({ unsignedDelegation: intent.unsignedDelegation, delegationHash: intent.delegationHash,
        signingDigest: intent.signingDigest, relayTo: intent.relayTo, mode: intent.mode }, { owner: binding.address, chainId: request.chainId, executions: intent.quote.executions }, "mm_gasless_state_corrupt");
    return intent;
}
function approval(value, fingerprint, expiresAt, at) {
    if (value === null)
        return null;
    const a = mmExact(value, ["fingerprint", "approvedAt", "expiresAt"]);
    if (mmHash(a.fingerprint) !== fingerprint || mmIso(a.expiresAt) !== expiresAt ||
        time(mmIso(a.approvedAt)) > time(at) || time(a.approvedAt) >= time(expiresAt))
        corrupt();
    return a;
}
/**
 * The repriced batch and its re-derived delegation, checked by exactly the rules the prepared material passed:
 * inside the owner's effective cap, above the recipient's floor, an exact split of the gross, and a delegation
 * derived from those two executions alone. `undefined` is a record written before this field existed.
 */
function dispatchMaterial(value, intent) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    const d = mmExact(value, ["quote", "unsignedDelegation", "delegationHash", "signingDigest", "relayTo", "mode"]);
    mmHex(d.delegationHash, 32);
    mmHex(d.signingDigest, 32);
    mmCanonicalAddress(d.relayTo);
    mmHex(d.mode, 32);
    const quote = mmRepriceWithinCap(d.quote, intent.request, intent.binding, "mm_gasless_state_corrupt");
    mmValidateUnsigned({ unsignedDelegation: d.unsignedDelegation, delegationHash: d.delegationHash,
        signingDigest: d.signingDigest, relayTo: d.relayTo, mode: d.mode }, { owner: intent.binding.address, chainId: intent.request.chainId, executions: quote.executions }, "mm_gasless_state_corrupt");
    return d;
}
function providerObservation(value, intent, at) {
    if (value === null)
        return null;
    const p = mmExact(value, ["observedAt", "requestIdHash", "status", "txHash"]);
    if (time(mmIso(p.observedAt)) > time(at) || p.requestIdHash !== mmPrivateHash("request-id", intent.requestId) ||
        !["awaiting_approval", "pending", "broadcasted", "confirmed", "failed", "unavailable"].includes(p.status))
        corrupt();
    if (p.txHash !== null)
        mmHex(p.txHash, 32);
    return p;
}
function cursor(value, intent) {
    const c = mmExact(value, ["startBlock", "nextBlockAtomic", "previousEndBlock"]);
    const startBlock = block(c.startBlock);
    if (!mmSame(startBlock, intent.initialSnapshot.safeBlock))
        corrupt();
    const next = mmUint(c.nextBlockAtomic);
    if (next < BigInt(startBlock.numberAtomic))
        corrupt();
    if (c.previousEndBlock !== null) {
        const previous = block(c.previousEndBlock);
        if (BigInt(previous.numberAtomic) < BigInt(startBlock.numberAtomic) || BigInt(previous.numberAtomic) + 1n !== next)
            corrupt();
    }
    else if (next !== BigInt(startBlock.numberAtomic))
        corrupt();
    return c;
}
function observation(value, at) {
    if (value === null)
        return null;
    const sourced = typeof value === "object" && value !== null && Object.hasOwn(value, "source");
    const o = mmExact(value, ["observedAt", "phase", "reason", "candidateTxHash", "transactionBlock", "finalityBlock", "evidenceHash",
        ...(sourced ? ["source"] : [])]);
    if (sourced)
        observationSource(o.source);
    if (time(mmIso(o.observedAt)) > time(at) || !["pending", "unavailable", "invalid", "reorg", "reverted", "success"].includes(o.phase) ||
        typeof o.reason !== "string" || !Object.hasOwn(MM_REASON_CODES, o.reason))
        corrupt();
    const exactReason = { pending: "mm_gasless_pending", unavailable: "mm_gasless_rpc_unavailable",
        reorg: "mm_gasless_scan_reorg", reverted: "mm_gasless_transaction_reverted", success: "mm_gasless_success" };
    if (o.phase !== "invalid" && o.reason !== exactReason[o.phase])
        corrupt();
    if (o.phase === "invalid" && !["mm_gasless_evidence_invalid", "mm_gasless_rpc_binding"].includes(o.reason))
        corrupt();
    if (o.candidateTxHash !== null)
        mmHex(o.candidateTxHash, 32);
    const transaction = o.transactionBlock === null ? null : block(o.transactionBlock);
    const finality = o.finalityBlock === null ? null : block(o.finalityBlock);
    if (transaction !== null && finality !== null)
        blockOrder(transaction, finality);
    if (o.evidenceHash !== null)
        mmHash(o.evidenceHash);
    if (["success", "reverted"].includes(o.phase) &&
        (o.candidateTxHash === null || transaction === null || finality === null || o.evidenceHash === null))
        corrupt();
    return o;
}
function observationSource(value) {
    const s = mmExact(value, ["environmentName", "endpointOrigin", "endpointHash"]);
    if (typeof s.environmentName !== "string" || s.environmentName.length > 128 || !/^APN_[A-Z0-9_]+_RPC_URL$/u.test(s.environmentName))
        corrupt();
    origin(s.endpointOrigin);
    mmHash(s.endpointHash);
}
function settlement(value, intent, dispatched, at) {
    if (value === null)
        return null;
    const s = mmExact(value, ["observedAt", "txHash", "transactionBlock", "finalityBlock", "outerSender", "transactionProofHash",
        "receiptHash", "protocolHash", "tokenImplementationHash", "deliveredAtomic", "feeAtomic", "debitAtomic", "refundAtomic",
        "unusedGrossAtomic", "designation", "permission", "receiptCounterAtomic", "finalityCounterAtomic"]);
    if (time(mmIso(s.observedAt)) > time(at))
        corrupt();
    mmHex(s.txHash, 32);
    const transaction = block(s.transactionBlock), finality = block(s.finalityBlock);
    blockOrder(transaction, finality);
    if (BigInt(transaction.numberAtomic) < BigInt(intent.initialSnapshot.safeBlock.numberAtomic))
        corrupt();
    const outer = mmCanonicalAddress(s.outerSender);
    if (outer === MM_ZERO_ADDRESS || outer === intent.binding.address)
        corrupt();
    mmHash(s.transactionProofHash);
    mmHash(s.receiptHash);
    mmHash(s.protocolHash);
    mmHash(s.tokenImplementationHash);
    const deployment = mmRegistry(intent.request.chainId), row = deployment.row;
    const protocolHash = hashObject({ deploymentEvidenceHash: deployment.deploymentEvidenceHash,
        receipt: { block: transaction, code: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) => [name, pin.codeHash])) },
        finality: { block: finality, code: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) => [name, pin.codeHash])) } });
    const tokenState = { address: row.tokenImplementationAddress, codeHash: row.tokenImplementationCodeHash,
        proxyCodeHash: row.tokenProxyCodeHash };
    const tokenImplementationHash = hashObject({ token: row.token,
        receipt: { block: transaction, ...tokenState }, finality: { block: finality, ...tokenState } });
    if (s.protocolHash !== protocolHash || s.tokenImplementationHash !== tokenImplementationHash ||
        s.deliveredAtomic !== dispatched.netAtomic || s.feeAtomic !== dispatched.feeAtomic ||
        s.debitAtomic !== intent.request.grossAtomic || s.refundAtomic !== "0" || s.unusedGrossAtomic !== "0" ||
        s.designation !== "pinned" || s.permission !== "consumed" || s.receiptCounterAtomic !== "1" || s.finalityCounterAtomic !== "1")
        corrupt();
    return s;
}
function failure(value) {
    if (value === null)
        return null;
    const f = mmExact(value, ["code", "reason"]);
    if (typeof f.reason !== "string" || f.reason === "mm_gasless_success" || !Object.hasOwn(MM_REASON_CODES, f.reason) ||
        f.code !== MM_REASON_CODES[f.reason])
        corrupt();
    return f;
}
export function mmJournalMutable(value, intent, fingerprint, atInput) {
    const at = mmIso(atInput), m = mmExact(recordMutable(value), MUTABLE_KEYS);
    if (!STATES.includes(m.state) || (m.submissionAttempts !== 0 && m.submissionAttempts !== 1))
        corrupt();
    const a = approval(m.approval, fingerprint, intent.expiresAt, at);
    const dispatch = m.dispatchStartedAt === null ? null : mmIso(m.dispatchStartedAt);
    if ((m.submissionAttempts === 0) !== (dispatch === null) ||
        (dispatch !== null && (a === null || time(dispatch) > time(at) || time(dispatch) < time(a.approvedAt) ||
            time(dispatch) + MM_MIN_REMAINING_MS > time(intent.expiresAt))))
        corrupt();
    const dispatched = dispatchMaterial(m.dispatch, intent);
    // A reprice is only ever written in the same durable transition as the dispatch marker.
    if (dispatched !== null && dispatched !== undefined && m.submissionAttempts !== 1)
        corrupt();
    const provider = providerObservation(m.providerObservation, intent, at), c = cursor(m.cursor, intent), o = observation(m.observation, at);
    const settled = settlement(m.settlement, intent, dispatched?.quote ?? intent.quote, at), failed = failure(m.failure);
    const state = m.state, before = m.submissionAttempts === 0;
    const initialCursor = { startBlock: intent.initialSnapshot.safeBlock,
        nextBlockAtomic: intent.initialSnapshot.safeBlock.numberAtomic, previousEndBlock: null };
    if ((before || state === "dispatch_pending") && !mmSame(c, initialCursor))
        corrupt();
    if (["awaiting_approval", "execution_pending"].includes(state) && (!before || provider !== null || o !== null || settled !== null || failed !== null))
        corrupt();
    if (state === "awaiting_approval" && a !== null)
        corrupt();
    if (state === "execution_pending" && a === null)
        corrupt();
    if (state === "dispatch_pending" && (before || a === null || provider !== null || o !== null || settled !== null || failed !== null))
        corrupt();
    if (state === "failed_before_effect" && (!before || provider !== null || o !== null || settled !== null || failed === null))
        corrupt();
    if (state === "abandoned_unknown" && (before || a === null || settled !== null || failed?.reason !== "mm_gasless_owner_abandoned"))
        corrupt();
    if (state === "submitted_pending" && (before || a === null || settled !== null || failed?.reason !== "mm_gasless_pending" ||
        provider === null || !["broadcasted", "confirmed"].includes(provider.status) ||
        provider.txHash === null || o === null || o.phase !== "pending" || o.candidateTxHash !== provider.txHash))
        corrupt();
    if (state === "unknown_finality" && (before || a === null || settled !== null || failed === null || o?.phase === "reverted" || o?.phase === "success"))
        corrupt();
    if (state === "failed_effects_pending" && (before || a === null || settled !== null ||
        failed?.reason !== "mm_gasless_transaction_reverted" || o === null || o.phase === "success"))
        corrupt();
    if (state === "completed" && (before || a === null || failed !== null || settled === null || o?.phase !== "success" ||
        o.candidateTxHash !== settled.txHash || !mmSame(o.transactionBlock, settled.transactionBlock) ||
        !mmSame(o.finalityBlock, settled.finalityBlock) || o.observedAt !== settled.observedAt))
        corrupt();
    return { state, approval: a, submissionAttempts: m.submissionAttempts, dispatchStartedAt: dispatch,
        dispatch: dispatched, providerObservation: provider, cursor: c, observation: o, settlement: settled, failure: failed };
}
//# sourceMappingURL=schema.js.map