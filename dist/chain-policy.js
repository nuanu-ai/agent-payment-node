import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { validateChainAccount } from "./chain-account-store.js";
import { ApnError } from "./errors.js";
import { TRON_GENESIS } from "./tron/constants.js";
export const SOLANA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ASSETS = [
    { rail: "solana", network: "mainnet", alias: "sol", kind: "native", identifier: "native:sol", symbol: "SOL", decimals: 9 },
    { rail: "solana", network: "mainnet", alias: "usdc", kind: "token", identifier: SOLANA_USDC, symbol: "USDC", decimals: 6 },
    { rail: "tron", network: "mainnet", alias: "trx", kind: "native", identifier: "native:trx", symbol: "TRX", decimals: 6 },
    { rail: "tron", network: "mainnet", alias: "usdt", kind: "token", identifier: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", symbol: "USDT", decimals: 6 },
];
export function chainAsset(rail, alias) {
    const found = ASSETS.find((asset) => asset.rail === rail && asset.alias === alias);
    if (found === undefined)
        throw new ApnError("APN_INVALID_INPUT", "The asset is not admitted on this direct rail.");
    return { ...found };
}
export function validateChainAsset(value) {
    const found = ASSETS.find((asset) => canonicalJson(asset) === canonicalJson(value));
    if (found === undefined)
        corrupt();
    return { ...found };
}
export function atomic(value, positive = false) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value))
        corrupt();
    const amount = BigInt(value);
    if (amount > 18446744073709551615n || (positive && amount === 0n))
        corrupt();
    return amount;
}
export function chainDecimal(value, decimals) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/u.test(value))
        invalidAmount();
    const [whole = "", fraction = ""] = value.split(".");
    if (whole.length > 20 || fraction.length > decimals)
        invalidAmount();
    const amount = BigInt(whole + fraction.padEnd(decimals, "0"));
    if (amount === 0n || amount > 18446744073709551615n)
        invalidAmount();
    return amount.toString();
}
export function chainDisplay(value, decimals) {
    atomic(value);
    const text = value.padStart(decimals + 1, "0");
    const fraction = text.slice(-decimals).replace(/0+$/u, "");
    return `${text.slice(0, -decimals)}${fraction === "" ? "" : `.${fraction}`}`;
}
export function isoDate(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        corrupt();
}
export function sealChainPolicy(value) {
    return validateChainPolicy({ ...value, policyHash: hashObject(value) });
}
export function validateChainPolicy(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "account", "asset", "networkIdentity", "maximumPerTransferAtomic", "dailyLimitAtomic", "maximumNativeFeeAtomic", "admittedAt", "policyHash"]))
        corrupt();
    if (value.schemaVersion !== "apn.chain-policy.v1")
        corrupt();
    const account = validateChainAccount(value.account);
    const asset = validateChainAsset(value.asset);
    if (account.rail !== asset.rail || value.networkIdentity !== (account.rail === "solana" ? SOLANA_GENESIS : TRON_GENESIS))
        corrupt();
    if (atomic(value.maximumPerTransferAtomic, true) > atomic(value.dailyLimitAtomic, true))
        corrupt();
    atomic(value.maximumNativeFeeAtomic, true);
    isoDate(value.admittedAt);
    const { policyHash, ...body } = value;
    if (typeof policyHash !== "string" || hashObject(body) !== policyHash)
        corrupt();
    return value;
}
/** Nonterminal reservations remain charged even across a UTC-day boundary. */
export function chainUsage(policy, operations, now, excluding) {
    let principal = 0n;
    let nativeFees = 0n;
    for (const operation of operations) {
        if (operation.operationId === excluding || operation.profileHash !== policy.account.profileHash || operation.account.rail !== policy.account.rail)
            continue;
        const sameAsset = operation.prepared.asset.identifier === policy.asset.identifier;
        if (!operation.terminal) {
            if (sameAsset)
                principal += atomic(operation.prepared.amountAtomic);
            nativeFees += atomic(operation.prepared.economics.maximumNativeDebitAtomic);
        }
        else if (operation.updatedAt.slice(0, 10) === now.toISOString().slice(0, 10)) {
            if (sameAsset && operation.state === "completed")
                principal += atomic(operation.prepared.amountAtomic);
            const proof = operation.evidence;
            if (proof !== null && proof.networkFeePayer === operation.account.address)
                nativeFees += atomic(proof.actualNetworkFeeAtomic);
            if (proof !== null && operation.prepared.economics.rentPayer === operation.account.address)
                nativeFees += atomic(proof.actualRecipientRentAtomic);
        }
    }
    return { principalAtomic: principal.toString(), nativeFeeAtomic: nativeFees.toString() };
}
export function assertChainPolicy(policy, account, asset, amount, maximumFee, operations, now, excluding) {
    validateChainPolicy(policy);
    if (canonicalJson(policy.account) !== canonicalJson(account) || canonicalJson(policy.asset) !== canonicalJson(asset))
        denied();
    if (atomic(amount, true) > atomic(policy.maximumPerTransferAtomic) || atomic(maximumFee, true) > atomic(policy.maximumNativeFeeAtomic))
        denied();
    const usage = chainUsage(policy, operations, now, excluding);
    if (BigInt(usage.principalAtomic) + atomic(amount) > atomic(policy.dailyLimitAtomic))
        denied();
}
/** Direct rails keep chain policies only for the native fee, rent and resource cap; owner amount caps live in the allowlist policy. */
export function assertChainFeePolicy(policy, account, asset, maximumFee) {
    validateChainPolicy(policy);
    if (canonicalJson(policy.account) !== canonicalJson(account) || canonicalJson(policy.asset) !== canonicalJson(asset))
        denied();
    if (atomic(maximumFee, true) > atomic(policy.maximumNativeFeeAtomic))
        denied();
}
function denied() { throw new ApnError("APN_OPERATION_BLOCKED", "The chain asset policy or spending limit does not authorize this transfer."); }
function invalidAmount() { throw new ApnError("APN_INVALID_INPUT", "Use a positive canonical decimal amount within the asset precision and integer range."); }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The chain policy, asset or atomic value is invalid."); }
//# sourceMappingURL=chain-policy.js.map