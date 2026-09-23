import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertUsdtFunding } from "./engine.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { usdtUserOperation } from "./userop.js";
const TOKEN_ABI = parseAbi(["function approve(address spender,uint256 value) returns (bool)", "function transfer(address to,uint256 value) returns (bool)"]);
const ACCOUNT_ABI = parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]);
const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c`;
const STUB_WORD = `0x${"11".repeat(32)}`;
const HASH = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const serializable = (value) => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
function frozenCopy(value) {
    const copy = structuredClone(value);
    const freeze = (entry) => {
        if (entry !== null && typeof entry === "object") {
            for (const nested of Object.values(entry))
                freeze(nested);
            Object.freeze(entry);
        }
    };
    freeze(copy);
    return copy;
}
function canonicalAddress(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
    try {
        if (getAddress(value) === value)
            return value;
    }
    catch { /* refused below */ }
    usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
}
function requirePolicy(active, request, usage, now) {
    if (active === null)
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_required");
    if (active.profile !== request.profile || active.accounts.evm !== request.sender || active.digest !== active.registry.policyDigest ||
        !DIGEST.test(active.digest) || !DIGEST.test(active.activationDigest) || !Number.isSafeInteger(active.revision) || active.revision < 1) {
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_identity");
    }
    const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token },
        rail: "gasless", amountAtomic: request.grossAtomic.toString(), dailyUsageAtomic: usage,
        asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    if (admission.asset.mechanismPins?.gasless?.provider !== USDT_GASLESS.mechanism.provider ||
        admission.asset.mechanismPins.gasless.reference !== USDT_GASLESS.mechanism.reference ||
        BigInt(admission.caps.maximumPerTransferAtomic) <= 0n || BigInt(admission.caps.dailyLimitAtomic) <= 0n) {
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_mechanism");
    }
    return active;
}
export function usdtApprovalTransferBatch(plan) {
    const approveZero = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, 0n] });
    const approveExact = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, plan.feeCapAtomic] });
    const transfer = encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [plan.request.recipient, plan.netAtomic] });
    return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[
                { target: USDT_GASLESS.token, value: 0n, data: approveZero },
                { target: USDT_GASLESS.token, value: 0n, data: approveExact },
                { target: USDT_GASLESS.token, value: 0n, data: transfer },
            ]] });
}
/** Domain-only prepare: quote and sponsor reads are checked twice; no journal, reservation, signature or send is reachable. */
export async function preparePolicyBoundUsdt(ports, request) {
    if (request.chain !== USDT_GASLESS.chain || request.token !== USDT_GASLESS.token ||
        request.sponsorUrl !== USDT_GASLESS.bundlerUrl || !request.profile)
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_route_binding");
    const now = ports.prepare.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
    const startMilliseconds = now.getTime();
    const sender = canonicalAddress(request.sender), recipient = canonicalAddress(request.recipient);
    if ([sender, USDT_GASLESS.token, USDT_GASLESS.paymaster, USDT_GASLESS.entryPoint, USDT_GASLESS.delegate,
        USDT_GASLESS.treasury].includes(recipient))
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_recipient");
    if (typeof request.grossAtomic !== "bigint" || typeof request.maxFeeAtomic !== "bigint" ||
        typeof request.minReceivedAtomic !== "bigint")
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_amount_type");
    const profile = request.profile;
    const transferRequest = { sender, recipient, grossAtomic: request.grossAtomic,
        maxFeeAtomic: request.maxFeeAtomic, minReceivedAtomic: request.minReceivedAtomic };
    const policyRequest = { ...transferRequest, profile, chain: USDT_GASLESS.chain,
        token: USDT_GASLESS.token, sponsorUrl: USDT_GASLESS.bundlerUrl };
    const usage = await ports.prepare.dailyUsage(sender, new Date(startMilliseconds));
    const active = requirePolicy(await ports.prepare.activePolicy(profile), policyRequest, usage, new Date(startMilliseconds));
    const policyDigest = active.digest, policyRevision = active.revision, activationDigest = active.activationDigest;
    const snapshot = await ports.prepare.safeSnapshot(sender);
    const { chainId, blockNumber, blockHash } = snapshot;
    const { usdtBalanceAtomic, entryPointNonce, eoaNonce, delegation } = snapshot.account;
    if (chainId !== 1n || typeof blockNumber !== "bigint" || blockNumber < 1n ||
        typeof blockHash !== "string" || !HASH.test(blockHash) || typeof usdtBalanceAtomic !== "bigint" ||
        usdtBalanceAtomic < 0n || typeof entryPointNonce !== "bigint" || entryPointNonce < 0n ||
        typeof eoaNonce !== "bigint" || eoaNonce < 0n || !["empty", "expected"].includes(delegation)) {
        usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_safe_block");
    }
    const account = Object.freeze({ usdtBalanceAtomic, entryPointNonce, eoaNonce, delegation });
    const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
    const price = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
    const plan = planUsdtTransfer(transferRequest, quote, price);
    assertUsdtFunding(plan, account);
    const callData = usdtApprovalTransferBatch(plan);
    const authorization = account.delegation === "empty" ? Object.freeze({
        chainId: "0x1", address: USDT_GASLESS.delegate, nonce: `0x${account.eoaNonce.toString(16)}`,
        yParity: "0x0", r: STUB_WORD, s: STUB_WORD,
    }) : null;
    const draft = frozenCopy(usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData,
        paymasterData: "0x", signature: ESTIMATE_SIGNATURE, authorization }));
    const result = await ports.sponsor.paymasterData(draft);
    const paymaster = validateUsdtPaymasterData(result, plan, BigInt(Math.floor(startMilliseconds / 1000)));
    if (paymaster.exchangeRate !== plan.quote.exchangeRate) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_signed_quote_rate_mismatch");
    }
    const paymasterData = result.paymasterData.toLowerCase();
    const freshQuote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
    const freshPrice = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
    if (canonicalJson(serializable(freshQuote)) !== canonicalJson(serializable(quote)) ||
        canonicalJson(serializable(freshPrice)) !== canonicalJson(serializable(price))) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_drift");
    }
    const finalNow = ports.prepare.now();
    if (!(finalNow instanceof Date) || !Number.isFinite(finalNow.getTime()) || finalNow.getTime() < startMilliseconds) {
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
    }
    validateUsdtPaymasterData(result, plan, BigInt(Math.floor(finalNow.getTime() / 1000)));
    const freshUsage = await ports.prepare.dailyUsage(sender, finalNow);
    const current = requirePolicy(await ports.prepare.activePolicy(profile), policyRequest, freshUsage, finalNow);
    if (current.digest !== policyDigest || current.revision !== policyRevision || current.activationDigest !== activationDigest ||
        freshUsage !== usage)
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_changed");
    const unsignedOperation = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData,
        paymasterData, signature: ESTIMATE_SIGNATURE, authorization });
    const body = frozenCopy({ schemaVersion: "apn.gasless-usdt-policy-prepare.v1", profile, policyDigest,
        policyRevision, activationDigest, chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
        mechanism: USDT_GASLESS.mechanism, sponsorUrl: USDT_GASLESS.bundlerUrl, safeBlockNumber: blockNumber.toString(),
        safeBlockHash: blockHash, account, plan, callData, paymaster, paymasterData, unsignedOperation });
    return Object.freeze({ ...body, bindingHash: hashObject(serializable(body)) });
}
//# sourceMappingURL=policy-prepare.js.map