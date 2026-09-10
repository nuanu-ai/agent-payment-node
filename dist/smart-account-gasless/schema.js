import { isAddress, keccak256 } from "viem";
import { exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { SA_CHAIN_ID, SA_MAX_UINT, SA_MIN_REMAINING_MS, SA_PROTOCOL_NAMES, SA_TTL_MS, SA_ZERO_ADDRESS } from "./model.js";
import { saFail } from "./reasons.js";
import { saRegistry } from "./registry.js";
import { saPolicyHash, saSame } from "./integrity.js";
const CORRUPT = "sa_gasless_state_corrupt";
export function saExact(value, keys, reason = CORRUPT) {
    if (!isPlainRecord(value) || !exactKeys(value, keys))
        saFail(reason);
    return value;
}
export function saUint(value, positive = false, reason = CORRUPT) {
    if (typeof value !== "string" || value.length > 78 || !/^(?:0|[1-9][0-9]*)$/u.test(value))
        saFail(reason);
    const n = BigInt(value);
    if (n > SA_MAX_UINT || (positive && n === 0n))
        saFail(reason);
    return n;
}
export function saHash(value, reason = CORRUPT) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
        saFail(reason);
    return value;
}
export function saHex(value, bytes, reason = CORRUPT) {
    if (typeof value !== "string" || value.length > 2 + 65536 * 2 || !/^0x(?:[0-9a-f]{2})*$/u.test(value) ||
        (bytes !== undefined && value.length !== 2 + bytes * 2))
        saFail(reason);
    return value;
}
export function saAddress(value, reason = CORRUPT) {
    if (typeof value !== "string" || !isAddress(value, { strict: false }))
        saFail(reason);
    return value.toLowerCase();
}
export function saCanonicalAddress(value, reason = CORRUPT) {
    const result = saAddress(value, reason);
    if (result !== value)
        saFail(reason);
    return result;
}
export function saIso(value, reason = CORRUPT) {
    if (typeof value !== "string" || value.length !== 24 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        saFail(reason);
    return value;
}
export function saUnix(value, reason = CORRUPT) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 253402300799)
        saFail(reason);
    return value;
}
export function saOrigin(value, reason = CORRUPT) {
    if (typeof value !== "string" || value.length > 256)
        saFail(reason);
    try {
        const url = new URL(value);
        if (url.origin !== value || url.protocol !== "https:" || url.username || url.password)
            saFail(reason);
    }
    catch {
        saFail(reason);
    }
    return value;
}
export function saRequest(value, reason = "sa_gasless_input") {
    const r = saExact(value, ["chainId", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic"], reason);
    if (r.chainId !== SA_CHAIN_ID)
        saFail(reason === CORRUPT ? CORRUPT : "sa_gasless_capability");
    const recipient = saAddress(r.recipient, reason), gross = saUint(r.grossAtomic, true, reason);
    const minimum = saUint(r.minReceivedAtomic, true, reason);
    saUint(r.maxFeeAtomic, false, reason);
    const registry = saRegistry(SA_CHAIN_ID);
    if (minimum > gross || recipient === SA_ZERO_ADDRESS || recipient === registry.token.address ||
        Object.values(registry.protocol).some(p => p.address === recipient))
        saFail(reason);
    return { chainId: SA_CHAIN_ID, recipient, grossAtomic: r.grossAtomic,
        maxFeeAtomic: r.maxFeeAtomic, minReceivedAtomic: r.minReceivedAtomic };
}
export function saBinding(value) {
    const b = saExact(value, ["providerId", "trustClass", "profileHash", "ownerAddress", "sessionAddress",
        "accountBindingHash", "capabilityHash", "profileRevision", "permissionRevision", "rootGrantFingerprint",
        "encodedRootHash", "rootDelegationHash", "delegationManager", "rootCapAtomic", "rootStartsAtUnix",
        "rootExpiresAtUnix", "periodTerms", "rootNonceAtomic"]);
    if (b.providerId !== "metamask-smart-account" || b.trustClass !== "external_owner_delegated_local_session")
        saFail(CORRUPT);
    const owner = saCanonicalAddress(b.ownerAddress), session = saCanonicalAddress(b.sessionAddress);
    if (owner === SA_ZERO_ADDRESS || session === SA_ZERO_ADDRESS || owner === session)
        saFail(CORRUPT);
    for (const key of ["profileHash", "accountBindingHash", "capabilityHash", "rootGrantFingerprint", "encodedRootHash"])
        saHash(b[key]);
    for (const key of ["profileRevision", "permissionRevision"]) {
        if (typeof b[key] !== "number" || !Number.isSafeInteger(b[key]) || b[key] < 1)
            saFail(CORRUPT);
    }
    const registry = saRegistry(SA_CHAIN_ID);
    if (saCanonicalAddress(b.delegationManager) !== registry.protocol.manager.address ||
        b.accountBindingHash !== sha256(`provider-account-binding\0metamask-smart-account\0${owner}`))
        saFail(CORRUPT);
    saHex(b.rootDelegationHash, 32);
    saUint(b.rootNonceAtomic);
    const cap = saUint(b.rootCapAtomic, true), start = saUnix(b.rootStartsAtUnix), expiry = saUnix(b.rootExpiresAtUnix);
    const terms = saHex(b.periodTerms, 116);
    // The retained erc20-token-allowance decoder uses an effectively non-resetting UINT256_MAX period.
    if (start === 0 || expiry <= start || terms.slice(0, 42) !== registry.token.address || BigInt(`0x${terms.slice(42, 106)}`) !== cap ||
        BigInt(`0x${terms.slice(106, 170)}`) !== SA_MAX_UINT || BigInt(`0x${terms.slice(170, 234)}`) !== BigInt(start))
        saFail(CORRUPT);
    return b;
}
export function saBlock(value) {
    const b = saExact(value, ["numberAtomic", "hash", "timestampAtomic"]);
    saUint(b.numberAtomic);
    saHex(b.hash, 32);
    const timestamp = saUint(b.timestampAtomic);
    if (timestamp > 253402300799n)
        saFail(CORRUPT);
    return b;
}
export function saBlockOrder(first, second) {
    if (BigInt(first.numberAtomic) > BigInt(second.numberAtomic) || BigInt(first.timestampAtomic) > BigInt(second.timestampAtomic) ||
        (first.numberAtomic === second.numberAtomic && !saSame(first, second)))
        saFail(CORRUPT);
}
function chainState(value, binding) {
    const s = saExact(value, ["ownerAddress", "sessionAddress", "ownerCodeHash", "sessionCodeHash", "protocolCodeHashes",
        "tokenProxyCodeHash", "tokenImplementationAddress", "tokenImplementationCodeHash", "tokenDomainSeparator", "tokenDecimals",
        "usdcBalanceAtomic", "ownerNativeBalanceWei", "sessionNativeBalanceWei", "availableAtomic", "allowancePeriodAtomic",
        "allowanceIsNewPeriod", "currentNonceAtomic"]);
    const r = saRegistry(SA_CHAIN_ID), codes = saExact(s.protocolCodeHashes, SA_PROTOCOL_NAMES);
    for (const name of SA_PROTOCOL_NAMES)
        if (saHex(codes[name], 32) !== r.protocol[name].codeHash)
            saFail(CORRUPT);
    if (saCanonicalAddress(s.ownerAddress) !== binding.ownerAddress || saCanonicalAddress(s.sessionAddress) !== binding.sessionAddress ||
        saHex(s.ownerCodeHash, 32) !== r.ownerDesignationCodeHash || saHex(s.sessionCodeHash, 32) !== keccak256("0x") ||
        saHex(s.tokenProxyCodeHash, 32) !== r.token.proxyCodeHash || saCanonicalAddress(s.tokenImplementationAddress) !== r.token.implementationAddress ||
        saHex(s.tokenImplementationCodeHash, 32) !== r.token.implementationCodeHash || saHex(s.tokenDomainSeparator, 32) !== r.token.domainSeparator ||
        s.tokenDecimals !== 6 || typeof s.allowanceIsNewPeriod !== "boolean")
        saFail(CORRUPT);
    for (const key of ["usdcBalanceAtomic", "ownerNativeBalanceWei", "sessionNativeBalanceWei", "availableAtomic", "allowancePeriodAtomic",
        "currentNonceAtomic"])
        saUint(s[key]);
    if (s.currentNonceAtomic !== binding.rootNonceAtomic || BigInt(s.availableAtomic) > BigInt(binding.rootCapAtomic))
        saFail(CORRUPT);
    return s;
}
export function saSnapshot(value, binding) {
    const s = saExact(value, ["chainId", "endpointOrigin", "endpointHash", "observedAt", "preparationBlock", "safeBlock", "safeState"]);
    if (s.chainId !== SA_CHAIN_ID)
        saFail(CORRUPT);
    saOrigin(s.endpointOrigin);
    saHash(s.endpointHash);
    saIso(s.observedAt);
    const preparation = saBlock(s.preparationBlock), safe = saBlock(s.safeBlock);
    saBlockOrder(safe, preparation);
    chainState(s.safeState, binding);
    if (BigInt(preparation.timestampAtomic) * 1000n > BigInt(Date.parse(s.observedAt)))
        saFail(CORRUPT);
    return s;
}
export function saProviderBinding(value) {
    const p = saExact(value, ["endpointOrigin", "endpointHash", "facilitatorAddresses", "supportedResponseHash", "observedAt"]);
    const r = saRegistry(SA_CHAIN_ID);
    if (saOrigin(p.endpointOrigin) !== r.facilitatorOrigin || saHash(p.endpointHash) !== r.facilitatorEndpointHash ||
        !saSame(p.facilitatorAddresses, r.facilitatorAddresses))
        saFail(CORRUPT);
    saHash(p.supportedResponseHash);
    saIso(p.observedAt);
    return p;
}
export function saRequirements(value) {
    const p = saExact(value, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]);
    const extra = saExact(p.extra, ["assetTransferMethod", "facilitatorAddresses"]), r = saRegistry(SA_CHAIN_ID);
    if (p.scheme !== "exact" || p.network !== "eip155:8453" || saCanonicalAddress(p.asset) !== r.token.address ||
        extra.assetTransferMethod !== "erc7710" || !saSame(extra.facilitatorAddresses, r.facilitatorAddresses) ||
        saUnix(p.maxTimeoutSeconds) < SA_MIN_REMAINING_MS / 1000 || Number(p.maxTimeoutSeconds) > SA_TTL_MS / 1000)
        saFail(CORRUPT);
    saCanonicalAddress(p.payTo);
    saUint(p.amount, true);
    return p;
}
export function saStateCounters(value) {
    const c = saExact(value, ["state", "signingAttempts", "exposureAttempts", "submissionAttempts"]);
    const phases = {
        awaiting_approval: [0, 0, [0]], execution_pending: [0, 0, [0]],
        material_pending: [1, 0, [0]], material_sealed: [1, 0, [0]],
        exposure_pending: [1, 1, [0]], verified_pending: [1, 1, [0]],
        dispatch_pending: [1, 1, [1]], submitted_pending: [1, 1, [1]],
        unknown_finality: [1, 1, [0, 1]], completed: [1, 1, [0, 1]], expired_unused: [1, 1, [0, 1]],
        failed_before_effect: [-1, 0, [0]],
    };
    for (const name of ["signingAttempts", "exposureAttempts", "submissionAttempts"]) {
        if (c[name] !== 0 && c[name] !== 1)
            saFail(CORRUPT);
    }
    if (typeof c.state !== "string" || !Object.hasOwn(phases, c.state))
        saFail(CORRUPT);
    const [sign, exposure, submissions] = phases[c.state];
    if ((sign !== -1 && c.signingAttempts !== sign) || c.exposureAttempts !== exposure ||
        !submissions.includes(c.submissionAttempts))
        saFail(CORRUPT);
    return c;
}
function intent(value) {
    const i = saExact(value, ["profile", "request", "binding", "token", "decimals", "deploymentEvidenceHash", "provider",
        "initialSnapshot", "requirements", "preparedAt", "expiresAt", "afterUnix", "beforeUnix", "policyHash"]);
    if (typeof i.profile !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(i.profile))
        saFail(CORRUPT);
    const request = saRequest(i.request, CORRUPT), binding = saBinding(i.binding), r = saRegistry(request.chainId);
    if (!saSame(request, i.request) || binding.profileHash !== sha256(`profile\0${i.profile}`) ||
        request.recipient === binding.ownerAddress || request.recipient === binding.sessionAddress ||
        saCanonicalAddress(i.token) !== r.token.address || i.decimals !== 6 || saHash(i.deploymentEvidenceHash) !== r.evidenceHash)
        saFail(CORRUPT);
    const initial = saSnapshot(i.initialSnapshot, binding), provider = saProviderBinding(i.provider);
    const requirements = saRequirements(i.requirements), preparedAt = saIso(i.preparedAt), expiresAt = saIso(i.expiresAt);
    const after = saUnix(i.afterUnix), before = saUnix(i.beforeUnix), prepared = Date.parse(preparedAt), expires = Date.parse(expiresAt);
    if (after !== Math.floor(prepared / 1000) || before !== Math.min(after + SA_TTL_MS / 1000, binding.rootExpiresAtUnix) ||
        expires !== before * 1000 || expires - prepared < SA_MIN_REMAINING_MS || binding.rootStartsAtUnix > after ||
        requirements.maxTimeoutSeconds !== before - after || requirements.amount !== request.grossAtomic ||
        requirements.payTo !== request.recipient || requirements.asset !== i.token ||
        Date.parse(initial.observedAt) > expires || Date.parse(provider.observedAt) > expires ||
        Date.parse(initial.observedAt) < prepared - SA_TTL_MS || Date.parse(provider.observedAt) < prepared - SA_TTL_MS ||
        BigInt(initial.safeState.usdcBalanceAtomic) < BigInt(request.grossAtomic) ||
        BigInt(initial.safeState.availableAtomic) < BigInt(request.grossAtomic) || saHash(i.policyHash) !== saPolicyHash(binding, request))
        saFail(CORRUPT);
    return i;
}
/** Stored public input has a closed deep schema; all failures are sanitized state corruption. */
export function validateSmartAccountGaslessIntent(value) {
    try {
        return intent(value);
    }
    catch {
        return saFail(CORRUPT);
    }
}
//# sourceMappingURL=schema.js.map