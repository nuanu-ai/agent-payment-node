import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { ApnError } from "./errors.js";
import { canonicalizeNormalizedProviderJson } from "./normalized-provider-json.js";
import { x402WaitProjectedStatus } from "./x402-state-integrity.js";
import { providerX402CompleteBindingHash, providerX402FrozenFingerprint, validateProviderX402Settlement, } from "./provider-x402-validation.js";
export const PROVIDER_X402_STATE_VERSION = "apn.provider-x402.state.v1";
export function providerX402RequestHash(input) {
    return hashObject({
        method: "x402.fetch.prepare",
        profile: input.profile,
        canonicalUrl: input.canonicalUrl,
        rpcUrl: input.rpcUrl,
        methodShape: "GET_absent_body",
        callerCapAtomic: input.callerCapAtomic ?? null,
    });
}
export function providerX402BindingHash(operation) {
    return providerX402CompleteBindingHash(operation);
}
export function providerX402InvocationIntentHash(input) {
    return domainHash("apn.provider-x402.invocation-intent.v1", canonicalJson(input));
}
export function appendProviderX402Transition(transitions, input) {
    const previousHash = transitions.at(-1)?.hash ?? "0".repeat(64);
    const base = { sequence: (transitions.length + 1).toString(), ...input, previousHash };
    return [...transitions, { ...base, hash: domainHash("apn.provider-x402.transition.v1", canonicalJson(base)) }];
}
export function sealProviderX402Operation(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function sealProviderX402Receipt(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function validateProviderX402Operation(value) {
    if (!isPlainRecord(value))
        corrupt();
    const operation = value;
    const without = { ...operation, integrityHash: undefined };
    delete without.integrityHash;
    if (operation.schemaVersion !== PROVIDER_X402_STATE_VERSION || operation.kind !== "x402_fetch" ||
        operation.executionMode !== "provider_atomic_paid_fetch" || !hash(operation.operationId) ||
        !hash(operation.idempotencyHash) || !hash(operation.profileHash) || !hash(operation.requestHash) ||
        !hash(operation.fingerprint) || operation.fingerprint !== providerX402FrozenFingerprint(operation) ||
        operation.integrityHash !== hashObject(without) ||
        operation.provider?.executionOwner !== "provider" ||
        operation.provider.retryOwner !== "apn_outer_no_replay_journal" || operation.request?.method !== "GET" ||
        operation.request.bodyState !== "absent" || operation.requirement?.x402Version !== "2" ||
        operation.requirement.scheme !== "exact" || operation.requirement.network !== CHAIN_CAIP2 ||
        operation.requirement.token !== BASE_USDC.toLowerCase() || operation.requirement.decimals !== 6 ||
        !positive(operation.requirement.amountAtomic) || operation.policy?.verdict !== "authorized_by_existing_profile_policy" ||
        BigInt(operation.requirement.amountAtomic) > BigInt(operation.policy.effectiveCapAtomic) ||
        (operation.preparedBalance !== undefined && operation.preparedBalance.accountBindingHash !== operation.provider.accountBindingHash) ||
        !Array.isArray(operation.transitions) || operation.transitions.length === 0 ||
        operation.transitions.at(-1)?.state !== operation.state || operation.transitions.at(-1)?.reason !== operation.reason ||
        operation.transitions.at(-1)?.proofClass !== operation.proofClass ||
        operation.terminal !== ["completed", "failed_before_effect", "failed_settled_without_result"].includes(operation.state))
        corrupt();
    validateTransitions(operation.transitions);
    if (operation.invocation !== undefined)
        validateInvocation(operation.invocation, operation);
    if (operation.sellerResult !== undefined)
        validateSellerResult(operation.sellerResult, operation.requirement.amountAtomic);
    if (operation.settlementEvidence !== undefined)
        validateProviderX402Settlement(operation.settlementEvidence, operation);
    if (operation.sellerResult !== undefined && operation.invocation === undefined)
        corrupt();
    if (!["preparing", "failed_before_effect"].includes(operation.state) && operation.preparedBalance === undefined)
        corrupt();
    if (!["preparing", "awaiting_approval", "failed_before_effect"].includes(operation.state) && (operation.finalPreflight?.requirementDigest !== operation.requirement.digest ||
        operation.evidenceLowerBlock === undefined || operation.evidenceDeadlineAt === undefined))
        corrupt();
    if (operation.state === "completed" && (operation.sellerResult === undefined || operation.settlementEvidence === undefined))
        corrupt();
    if (operation.state === "failed_settled_without_result" && (operation.reason !== "seller_result_missing" || operation.proofClass !== "confirmed_settlement_without_seller_result" ||
        operation.sellerResult !== undefined || operation.settlementEvidence === undefined))
        corrupt();
    return operation;
}
export function validateProviderX402Receipt(value) {
    if (!isPlainRecord(value))
        corrupt();
    const receipt = value;
    if (!exactKeys(value, [
        "schemaVersion", "kind", "operationId", "terminalState", "reason", "proofClass", "fingerprint",
        "requestDigest", "requirementDigest", "payer", "payee", "amountAtomic", "network", "token",
        ...(receipt.result === undefined ? [] : ["result"]),
        ...(receipt.settlement === undefined ? [] : ["settlement"]),
        "operationBindingHash", "createdAt", "integrityHash",
    ]))
        corrupt();
    const without = { ...receipt, integrityHash: undefined };
    delete without.integrityHash;
    if (receipt.schemaVersion !== "apn.provider-x402.receipt.v1" || receipt.kind !== "x402_fetch" ||
        !hash(receipt.operationId) || !hash(receipt.fingerprint) || !hash(receipt.requestDigest) ||
        !hash(receipt.requirementDigest) || receipt.integrityHash !== hashObject(without) ||
        !["completed", "failed_before_effect", "failed_settled_without_result"].includes(receipt.terminalState) ||
        receipt.network !== CHAIN_CAIP2 || receipt.token !== BASE_USDC.toLowerCase())
        corrupt();
    if (receipt.result !== undefined && (receipt.result.classification !== "normalized_provider_json" || !hash(receipt.result.sha256) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(receipt.result.byteLength)))
        corrupt();
    if (receipt.terminalState === "completed" && (receipt.result === undefined || receipt.settlement === undefined))
        corrupt();
    if (receipt.terminalState === "failed_before_effect" && (receipt.result !== undefined || receipt.settlement !== undefined))
        corrupt();
    if (receipt.terminalState === "failed_settled_without_result" && (receipt.reason !== "seller_result_missing" || receipt.proofClass !== "confirmed_settlement_without_seller_result" ||
        receipt.result !== undefined || receipt.settlement === undefined))
        corrupt();
    return receipt;
}
export function validateProviderX402Continuity(previous, next) {
    for (const key of [
        "schemaVersion", "kind", "executionMode", "operationId", "idempotencyHash", "profile", "profileHash",
        "requestHash", "fingerprint", "provider", "request", "requirement", "policy",
        "rpcBindingHash", "rpcOriginHash", "createdAt",
    ])
        if (canonicalJson(previous[key]) !== canonicalJson(next[key]))
            corrupt();
    for (const key of [
        "preparedBalance", "finalPreflight", "evidenceLowerBlock", "evidenceDeadlineAt", "immutableUpperBlock",
        "invocation", "sellerResult", "settlementEvidence",
    ]) {
        if (previous[key] !== undefined && canonicalJson(previous[key]) !== canonicalJson(next[key]))
            corrupt();
    }
    if (next.transitions.length !== previous.transitions.length + 1)
        corrupt();
    for (let index = 0; index < previous.transitions.length; index += 1) {
        if (canonicalJson(previous.transitions[index]) !== canonicalJson(next.transitions[index]))
            corrupt();
    }
    if (previous.terminal)
        corrupt();
    const allowed = {
        preparing: ["preparing", "awaiting_approval", "failed_before_effect"],
        awaiting_approval: ["started", "failed_before_effect"],
        started: ["settlement_pending", "ambiguous_effect", "failed_before_effect"],
        settlement_pending: ["settlement_pending", "ambiguous_effect", "completed", "failed_settled_without_result"],
        ambiguous_effect: ["ambiguous_effect", "failed_settled_without_result"],
        completed: [],
        failed_before_effect: [],
        failed_settled_without_result: [],
    };
    if (!allowed[previous.state].includes(next.state))
        corrupt();
}
export function publicProviderX402Operation(operation, settlementWait) {
    const waitStatus = x402WaitProjectedStatus(operation, settlementWait);
    const value = {
        schemaVersion: "apn.x402.public-operation.v1",
        kind: operation.kind,
        operationId: operation.operationId,
        state: operation.state,
        finalityClass: operation.finalityClass,
        terminal: operation.terminal,
        reason: waitStatus.reason,
        proofClass: waitStatus.proofClass,
        nextActions: operation.nextActions,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        resource: { origin: operation.request.origin, path: operation.request.path, urlHash: operation.request.urlHash },
        payer: operation.provider.payer,
        payee: operation.requirement.payee,
        amountAtomic: operation.requirement.amountAtomic,
        network: operation.requirement.network,
        token: operation.requirement.token,
        ...(operation.sellerResult === undefined ? {} : {
            result: {
                classification: operation.sellerResult.classification,
                resultHash: operation.sellerResult.sha256,
                byteLength: operation.sellerResult.byte_length,
            },
        }),
        ...(operation.settlementEvidence === undefined ? {} : {
            transactionHash: operation.settlementEvidence.transactionHash,
            blockNumber: operation.settlementEvidence.transfer.blockNumber,
            blockHash: operation.settlementEvidence.transfer.blockHash,
        }),
        ...(settlementWait === undefined ? {} : { settlementWait }),
    };
    return { ...value, integrityHash: domainHash("apn.x402.public-operation.v1", canonicalJson(value)) };
}
function validateTransitions(transitions) {
    let previous = "0".repeat(64);
    transitions.forEach((transition, index) => {
        const { hash: actual, ...base } = transition;
        if (transition.sequence !== String(index + 1) || transition.previousHash !== previous ||
            actual !== domainHash("apn.provider-x402.transition.v1", canonicalJson(base)))
            corrupt();
        previous = actual;
    });
}
function validateSellerResult(result, amount) {
    if (result.classification !== "normalized_provider_json" || result.payment_made !== true ||
        result.amount_paid_atomic !== amount || !/^(?:2[0-9]{2})$/u.test(result.http_status) ||
        result.byte_length !== Buffer.byteLength(result.canonical_json, "utf8").toString() ||
        result.sha256 !== sha256(result.canonical_json))
        corrupt();
    try {
        const parsed = JSON.parse(result.canonical_json);
        if (canonicalizeNormalizedProviderJson(parsed) !== result.canonical_json)
            corrupt();
    }
    catch {
        corrupt();
    }
}
function validateInvocation(invocation, operation) {
    if (!isPlainRecord(invocation) || !exactKeys(invocation, [
        "correlation_id", "request_digest", "intent_binding_hash", "child_identity_hash",
        "output_sha256", "output_byte_length",
    ]) || invocation.correlation_id !== operation.operationId || invocation.request_digest !== operation.request.requestDigest ||
        invocation.intent_binding_hash !== providerX402InvocationIntentHash({
            correlationId: operation.operationId,
            canonicalUrl: operation.request.canonicalUrl,
            amountAtomic: operation.requirement.amountAtomic,
            requestDigest: operation.request.requestDigest,
        }) ||
        !hash(invocation.child_identity_hash) || !hash(invocation.output_sha256) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(invocation.output_byte_length) || BigInt(invocation.output_byte_length) > 262144n)
        corrupt();
}
function hash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function positive(value) { return typeof value === "string" && /^[1-9][0-9]*$/u.test(value); }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Provider x402 protected state validation failed."); }
//# sourceMappingURL=provider-x402-model.js.map