import { hashObject } from "../canonical.js";
import { assertUsdtFunding } from "./engine.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
import { canonicalAddress, frozenCopy, requirePolicy, usdtApprovalTransferBatch, USDT_PREPARE_STUB_WORD } from "./policy-prepare.js";
import { validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { usdtUserOperation } from "./userop.js";
import { draftUsdtV2, signedUsdtV2 } from "./economics-v2.js";
import { verifyUsdtV2Auth, usdtQuoteChangedFields } from "./auth-v2-validation.js";
const HASH = /^0x[0-9a-f]{64}$/u;
const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c`;
const serializable = (value) => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
const preparedBindings = new WeakSet();
export function consumeUsdtV2Prepared(binding) {
    if (!preparedBindings.delete(binding))
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_fresh_auth_required_before_persist");
}
export async function preparePolicyBoundUsdtV2(ports, request) {
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
    const plan = draftUsdtV2(transferRequest, quote, price);
    assertUsdtFunding(plan, account);
    const callData = usdtApprovalTransferBatch(plan);
    const authorization = account.delegation === "empty" ? Object.freeze({
        chainId: "0x1", address: USDT_GASLESS.delegate, nonce: `0x${account.eoaNonce.toString(16)}`,
        yParity: "0x0", r: USDT_PREPARE_STUB_WORD, s: USDT_PREPARE_STUB_WORD,
    }) : null;
    const draft = frozenCopy(usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData,
        paymasterData: "0x", signature: ESTIMATE_SIGNATURE, authorization }));
    const result = await ports.sponsor.paymasterData(draft);
    const { plan: signedPlan, paymaster } = signedUsdtV2(result, plan, BigInt(Math.floor(startMilliseconds / 1000)));
    const paymasterData = result.paymasterData.toLowerCase();
    const freshQuote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
    const freshPrice = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
    const quoteFacts = { initialQuote: quote, initialPrice: price, freshQuote, freshPrice,
        changedFields: usdtQuoteChangedFields(quote, price, freshQuote, freshPrice) };
    const finalNow = ports.prepare.now();
    if (!(finalNow instanceof Date) || !Number.isFinite(finalNow.getTime()) || finalNow.getTime() < startMilliseconds) {
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
    }
    signedUsdtV2(result, plan, BigInt(Math.floor(finalNow.getTime() / 1000)));
    const freshUsage = await ports.prepare.dailyUsage(sender, finalNow);
    const current = requirePolicy(await ports.prepare.activePolicy(profile), policyRequest, freshUsage, finalNow);
    if (current.digest !== policyDigest || current.revision !== policyRevision || current.activationDigest !== activationDigest ||
        freshUsage !== usage)
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_changed");
    const unsignedOperation = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData,
        paymasterData, signature: "0x", authorization });
    if (ports.prepare.sponsorAuth === undefined || snapshot.pins === undefined)
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_auth_unavailable");
    const sponsorAuth = await ports.prepare.sponsorAuth(unsignedOperation, { ...snapshot, pins: snapshot.pins });
    await verifyUsdtV2Auth(unsignedOperation, sponsorAuth, { ...snapshot, pins: snapshot.pins });
    signedUsdtV2(result, plan, BigInt(Math.floor(ports.prepare.now().getTime() / 1000)));
    const lastNow = ports.prepare.now();
    if (lastNow.getTime() < startMilliseconds)
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
    const lastUsage = await ports.prepare.dailyUsage(sender, lastNow);
    const lastPolicy = requirePolicy(await ports.prepare.activePolicy(profile), policyRequest, lastUsage, lastNow);
    if (lastPolicy.digest !== policyDigest || lastPolicy.revision !== policyRevision || lastPolicy.activationDigest !== activationDigest || lastUsage !== usage)
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_changed");
    signedUsdtV2(result, plan, BigInt(Math.floor(ports.prepare.now().getTime() / 1000)));
    const body = frozenCopy({ schemaVersion: "apn.gasless-usdt-policy-prepare.v2", profile, policyDigest,
        policyRevision, activationDigest, chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
        mechanism: USDT_GASLESS.mechanism, sponsorUrl: USDT_GASLESS.bundlerUrl, safeBlockNumber: blockNumber.toString(),
        safeBlockHash: blockHash, account, plan: signedPlan, callData, paymaster, paymasterData, unsignedOperation, quoteFacts, sponsorAuth });
    const prepared = Object.freeze({ ...body, bindingHash: hashObject(serializable(body)) });
    preparedBindings.add(prepared);
    return prepared;
}
//# sourceMappingURL=policy-prepare-v2.js.map