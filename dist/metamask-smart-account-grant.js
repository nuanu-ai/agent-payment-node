import { makePermissionDecoderConfigs } from "@metamask/7715-permission-types";
import { getSmartAccountsEnvironment, ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { getAddress, isAddress, isHex } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
export const BASE_CHAIN_HEX = "0x2105";
export const UINT256_MAX_HEX = `0x${"f".repeat(64)}`;
export function smartAccountEnvironment() {
    return getSmartAccountsEnvironment(CHAIN_ID);
}
export function validateSmartAccountObservation(value, request) {
    const observation = parseObservation(value);
    assertPreflight(observation);
    if (observation.permission_responses.length !== 1)
        mismatch("MetaMask returned an unexpected permission count.");
    const response = parsePermissionResponse(observation.permission_responses[0]);
    const owner = canonicalAddress(observation.owner_address, "owner");
    if (response.chainId.toLowerCase() !== BASE_CHAIN_HEX ||
        response.from.toLowerCase() !== owner.toLowerCase() ||
        response.to.toLowerCase() !== request.sessionAddress.toLowerCase() ||
        response.delegationManager.toLowerCase() !== smartAccountEnvironment().DelegationManager.toLowerCase() ||
        response.dependencies.length !== 0)
        mismatch("MetaMask permission identity or deployment dependencies are unsupported.");
    const permission = response.permission;
    const data = permission.data;
    if (permission.type !== "erc20-token-allowance" || permission.isAdjustmentAllowed !== true ||
        canonicalAddress(data.tokenAddress, "token").toLowerCase() !== BASE_USDC.toLowerCase() ||
        !hexQuantity(data.allowanceAmount) || BigInt(data.allowanceAmount) <= 0n ||
        BigInt(data.allowanceAmount) > BigInt(request.capAtomic) ||
        data.startTime !== request.startsAtUnix)
        mismatch("MetaMask adjusted the permission outside the requested Base-USDC bounds.");
    const expiry = responseExpiry(response.rules);
    if (expiry <= request.nowUnix || expiry > request.expiresAtUnix) {
        mismatch("MetaMask returned an expired or widened permission expiry.");
    }
    const delegation = decodeRootDelegation(response.context);
    if (delegation.delegate.toLowerCase() !== request.sessionAddress.toLowerCase() ||
        delegation.delegator.toLowerCase() !== owner.toLowerCase() ||
        delegation.authority.toLowerCase() !== ROOT_AUTHORITY.toLowerCase() ||
        !isHex(delegation.signature) || delegation.signature.length < 4 || delegation.signature.length > 2050)
        mismatch("The signed root delegation does not bind the requested owner and session.");
    validateCaveats(delegation.caveats, request, expiry, String(data.allowanceAmount));
    return {
        ownerAddress: owner,
        grantedCapAtomic: BigInt(data.allowanceAmount).toString(),
        grantedExpiresAtUnix: expiry,
        context: response.context,
        grantFingerprint: domainHash("apn.metamask-smart-account.grant.v1", canonicalJson(response.raw)),
        delegationManager: canonicalAddress(response.delegationManager, "delegation manager"),
        permissionResponse: response.raw,
    };
}
export function assertSmartAccountPreflight(value) {
    const observation = parseObservation(value);
    assertPreflight(observation);
    return observation;
}
function assertPreflight(observation) {
    if (observation.chain_id.toLowerCase() !== BASE_CHAIN_HEX)
        mismatch("MetaMask is not connected to Base chain 8453.");
    const owner = canonicalAddress(observation.owner_address, "owner");
    const implementation = requiredAddress(smartAccountEnvironment().implementations.EIP7702StatelessDeleGatorImpl);
    const expectedCode = `0xef0100${implementation.slice(2)}`.toLowerCase();
    if (observation.account_code.toLowerCase() !== expectedCode) {
        throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "Enable the official MetaMask Smart Account on Base, then retry the same connect intent.", { retryable: true });
    }
    const supported = observation.supported_permissions;
    if (!isPlainRecord(supported))
        mismatch("MetaMask did not return supported execution permissions.");
    const allowance = supported["erc20-token-allowance"];
    if (!isPlainRecord(allowance) ||
        (allowance.chainIds !== undefined && (!Array.isArray(allowance.chainIds) ||
            !allowance.chainIds.some((item) => typeof item === "string" && item.toLowerCase() === BASE_CHAIN_HEX))) ||
        !Array.isArray(allowance.ruleTypes) || !allowance.ruleTypes.includes("expiry")) {
        mismatch("MetaMask does not advertise Base ERC-20 allowance permissions for the selected account.");
    }
    void owner;
}
function validateCaveats(caveats, request, expiry, grantedAmountHex) {
    const environment = smartAccountEnvironment();
    const expected = [
        environment.caveatEnforcers.ERC20PeriodTransferEnforcer,
        environment.caveatEnforcers.ValueLteEnforcer,
        environment.caveatEnforcers.NonceEnforcer,
        environment.caveatEnforcers.TimestampEnforcer,
    ].map((item) => item?.toLowerCase());
    if (caveats.length !== expected.length || new Set(caveats.map((item) => item.enforcer.toLowerCase())).size !== expected.length ||
        caveats.some((item) => !expected.includes(item.enforcer.toLowerCase()) || !isHex(item.terms) || item.args !== "0x")) {
        mismatch("The signed root delegation has an unsupported or duplicate caveat set.");
    }
    const config = makePermissionDecoderConfigs(permissionContracts(environment.caveatEnforcers))
        .find((item) => item.permissionType === "erc20-token-allowance");
    if (config === undefined)
        mismatch("The pinned MetaMask package has no ERC-20 allowance decoder.");
    const checksummed = caveats.map((item) => ({ ...item, enforcer: getAddress(item.enforcer) }));
    let decoded;
    try {
        decoded = config.validateAndDecodeData(checksummed, config.contractAddresses);
    }
    catch {
        return mismatch("The signed allowance caveats do not match the pinned Gator contract.");
    }
    if (canonicalAddress(decoded.tokenAddress, "decoded token").toLowerCase() !== BASE_USDC.toLowerCase() ||
        typeof decoded.allowanceAmount !== "string" || !isHex(decoded.allowanceAmount) ||
        BigInt(decoded.allowanceAmount) !== BigInt(grantedAmountHex) ||
        decoded.startTime !== request.startsAtUnix)
        mismatch("The decoded allowance caveat does not match the accepted permission.");
    const nonce = caveats.find((item) => item.enforcer.toLowerCase() === environment.caveatEnforcers.NonceEnforcer?.toLowerCase());
    if (nonce?.terms.length !== 66)
        mismatch("The Gator nonce caveat is malformed.");
    const required = new Map(Object.entries(config.requiredEnforcers).map(([address, count]) => [address, count]));
    let decodedRules;
    try {
        decodedRules = config.rules.map((decoder) => decoder({
            contractAddresses: config.contractAddresses,
            caveats: checksummed,
            requiredEnforcers: required,
        })).filter((item) => item !== null);
    }
    catch {
        return mismatch("The Gator permission rules are malformed.");
    }
    if (decodedRules.length !== 1 || !isPlainRecord(decodedRules[0]) || decodedRules[0].type !== "expiry" ||
        !isPlainRecord(decodedRules[0].data) || decodedRules[0].data.timestamp !== expiry) {
        mismatch("The delegation expiry, payee or redeemer rules are unsupported.");
    }
}
function parseObservation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "owner_address", "chain_id", "account_code", "supported_permissions", "permission_responses",
    ]) || typeof value.owner_address !== "string" || !isAddress(value.owner_address) ||
        typeof value.chain_id !== "string" || !isHex(value.chain_id) || typeof value.account_code !== "string" ||
        !isHex(value.account_code) || !Array.isArray(value.permission_responses))
        mismatch("MetaMask returned an unsupported bridge response.");
    return value;
}
function parsePermissionResponse(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "chainId", "from", "to", "permission", "rules", "context", "dependencies", "delegationManager",
    ]) || typeof value.chainId !== "string" || !isHex(value.chainId) || typeof value.from !== "string" ||
        !isAddress(value.from) || typeof value.to !== "string" || !isAddress(value.to) ||
        !isPlainRecord(value.permission) || !exactKeys(value.permission, ["type", "isAdjustmentAllowed", "data"]) ||
        !isPlainRecord(value.permission.data) || !exactKeys(value.permission.data, [
        "allowanceAmount", "startTime", "tokenAddress",
        ...(value.permission.data.justification === undefined ? [] : ["justification"]),
    ]) || !Array.isArray(value.rules) || typeof value.context !== "string" || !isHex(value.context) ||
        !Array.isArray(value.dependencies) || typeof value.delegationManager !== "string" || !isAddress(value.delegationManager)) {
        mismatch("MetaMask returned an unsupported permission response.");
    }
    return {
        raw: value,
        chainId: value.chainId,
        from: value.from,
        to: value.to,
        permission: value.permission,
        rules: value.rules,
        context: value.context,
        dependencies: value.dependencies,
        delegationManager: value.delegationManager,
    };
}
function decodeRootDelegation(context) {
    try {
        const delegations = decodeDelegations(context);
        if (delegations.length !== 1 || delegations[0] === undefined)
            mismatch("Permission context is not one signed root delegation.");
        return delegations[0];
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        return mismatch("Permission context cannot be decoded by the pinned MetaMask package.");
    }
}
function responseExpiry(rules) {
    if (rules.length !== 1 || !isPlainRecord(rules[0]) || !exactKeys(rules[0], ["type", "data"]) ||
        rules[0].type !== "expiry" || !isPlainRecord(rules[0].data) ||
        !exactKeys(rules[0].data, ["timestamp"]) || !Number.isSafeInteger(rules[0].data.timestamp)) {
        return mismatch("MetaMask returned unsupported permission rules.");
    }
    return Number(rules[0].data.timestamp);
}
function permissionContracts(enforcers) {
    return {
        erc20StreamingEnforcer: requiredAddress(enforcers.ERC20StreamingEnforcer),
        erc20PeriodTransferEnforcer: requiredAddress(enforcers.ERC20PeriodTransferEnforcer),
        nativeTokenStreamingEnforcer: requiredAddress(enforcers.NativeTokenStreamingEnforcer),
        nativeTokenPeriodTransferEnforcer: requiredAddress(enforcers.NativeTokenPeriodTransferEnforcer),
        approvalRevocationEnforcer: requiredAddress(enforcers.ApprovalRevocationEnforcer),
        exactCalldataEnforcer: requiredAddress(enforcers.ExactCalldataEnforcer),
        valueLteEnforcer: requiredAddress(enforcers.ValueLteEnforcer),
        timestampEnforcer: requiredAddress(enforcers.TimestampEnforcer),
        nonceEnforcer: requiredAddress(enforcers.NonceEnforcer),
        allowedCalldataEnforcer: requiredAddress(enforcers.AllowedCalldataEnforcer),
        allowedTargetsEnforcer: requiredAddress(enforcers.AllowedTargetsEnforcer),
        redeemerEnforcer: requiredAddress(enforcers.RedeemerEnforcer),
    };
}
function canonicalAddress(value, label) {
    if (typeof value !== "string" || !isAddress(value))
        mismatch(`MetaMask ${label} is not a canonical address.`);
    return getAddress(value);
}
function requiredAddress(value) {
    if (value === undefined || !isAddress(value))
        mismatch("The pinned MetaMask environment is incomplete.");
    return getAddress(value);
}
function hexQuantity(value) {
    return typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value);
}
function mismatch(message) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", message, { retryable: false });
}
//# sourceMappingURL=metamask-smart-account-grant.js.map