import { randomBytes } from "node:crypto";
import { canonicalJson, domainHash, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { planPermit2Authorization } from "./authorization.js";
import { tokenDomainSeparator } from "../x402-policy.js";
import { isEip2612GasSponsoringDeclaration } from "./extension.js";
import { selectPermit2Offer } from "./offer.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_EXACT_PERMIT2_PROXY_CODE_HASH, X402_PERMIT2_MECHANISM } from "./registry.js";
const PREPARE_DOMAIN = "apn.x402-permit2.prepare.v1";
const UINT256 = (1n << 256n) - 1n;
/** The resolver that admits exactly one asset: the operation's own. */
export function onlyPermit2Asset(asset) {
    return (network, token) => network === asset.chain && token.toLowerCase() === asset.token.toLowerCase() ? asset : undefined;
}
/** Pure prepare domain. The caller supplies trusted policy/RPC/facilitator reads; no effect port is accepted. */
export function preparePermit2Payment(input) {
    if (input.localWallet !== true)
        blocked("A local EVM wallet is required.", "x402_permit2_local_wallet_required");
    const sellerSponsorsEip2612 = validateChallenge(input.challenge);
    const challengeHash = hashChallenge(input.challenge);
    const asset = input.asset;
    const selection = selectPermit2Offer(input.challenge.accepts, input.payer, onlyPermit2Asset(asset));
    if (input.expected.challengeHash !== challengeHash || input.expected.index !== selection.index ||
        canonicalJson(input.expected.requirement) !== canonicalJson(selection.requirement)) {
        blocked("The merchant challenge or selected terms changed.", "x402_permit2_merchant_terms_mismatch");
    }
    const owner = input.owner;
    if (!owner.active || owner.rail !== "x402" || !same(owner.account, input.payer) || owner.chain !== asset.chain ||
        !same(owner.token, asset.token) || owner.mechanism?.provider !== X402_PERMIT2_MECHANISM.provider ||
        !same(owner.mechanism.reference, X402_EXACT_PERMIT2_PROXY) || !/^[a-f0-9]{64}$/u.test(owner.policyDigest)) {
        blocked("The active owner policy lacks the exact x402 Permit2 admission.", "x402_permit2_owner_admission_required");
    }
    const amount = BigInt(selection.amountAtomic);
    const perTransfer = quantity(owner.maximumPerTransferAtomic);
    const daily = quantity(owner.dailyLimitAtomic);
    const used = quantity(owner.usedTodayAtomic);
    if (perTransfer === 0n || daily === 0n || amount > perTransfer || used > daily || amount > daily - used) {
        blocked("The payment exceeds the active owner cap.", "x402_permit2_owner_cap_exceeded");
    }
    const evidence = input.evidence;
    if (evidence.chainId !== asset.chainId || !same(evidence.account, input.payer) ||
        !Number.isSafeInteger(evidence.observedAtSeconds) || evidence.observedAtSeconds > input.nowSeconds ||
        input.nowSeconds - evidence.observedAtSeconds > 30 ||
        (evidence.tokenDomainSeparator?.toLowerCase() ?? null) !== (asset.tokenDomainSeparator?.toLowerCase() ?? null) ||
        evidence.proxyCodeHash?.toLowerCase() !== X402_EXACT_PERMIT2_PROXY_CODE_HASH || asset.proxyCodeHash !== X402_EXACT_PERMIT2_PROXY_CODE_HASH ||
        evidence.permit2Deployed !== true) {
        blocked("Pinned chain, token domain or contract evidence is missing.", "x402_permit2_chain_evidence_required");
    }
    const facilitator = evidence.facilitator;
    if (!facilitator?.available || facilitator.network !== asset.chain || facilitator.scheme !== "exact" ||
        !same(facilitator.asset, asset.token) || facilitator.assetTransferMethod !== "permit2" ||
        !same(facilitator.permit2Address, PERMIT2_ADDRESS) || !same(facilitator.exactProxy, X402_EXACT_PERMIT2_PROXY)) {
        blocked("The exact keyless Permit2 facilitator capability is missing.", "x402_permit2_facilitator_unavailable");
    }
    if (quantity(evidence.balanceAtomic) < amount)
        blocked("The token balance is below the selected price.", "x402_permit2_balance_insufficient");
    const allowance = quantity(evidence.allowanceAtomic);
    if (typeof input.nonce !== "bigint" || input.nonce < 0n || input.nonce > UINT256 ||
        evidence.nonceBitmapWordIndex !== (input.nonce >> 8n).toString() ||
        typeof evidence.nonceBitmapWord !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(evidence.nonceBitmapWord)) {
        invalid("The Permit2 nonce observation is invalid.");
    }
    if (((BigInt(evidence.nonceBitmapWord) >> (input.nonce & 0xffn)) & 1n) !== 0n) {
        blocked("The Permit2 nonce is already consumed.", "x402_permit2_nonce_consumed");
    }
    if (allowance < amount && (!sellerSponsorsEip2612 || !facilitator.eip2612GasSponsoring)) {
        blocked("Allowance is insufficient and exact EIP-2612 sponsorship is unavailable.", "x402_permit2_allowance_required");
    }
    const eip2612Nonce = evidence.eip2612Nonce === null ? null : quantity(evidence.eip2612Nonce);
    if (allowance < amount && eip2612Nonce === null)
        blocked("The token permit nonce is missing.", "x402_permit2_eip2612_unavailable");
    const plan = planPermit2Authorization(selection, { payer: input.payer, nowSeconds: input.nowSeconds,
        nonce: input.nonce, permit2AllowanceAtomic: allowance.toString(), eip2612Nonce,
        sellerSponsorsEip2612: sellerSponsorsEip2612 && facilitator.eip2612GasSponsoring });
    // A sponsored permit signs the token's own EIP-712 domain: its name/version must recompute the on-chain separator.
    if (plan.eip2612 !== null && (asset.tokenDomain === null || asset.tokenDomainSeparator === null ||
        tokenDomainSeparator(asset.tokenDomain.name, asset.tokenDomain.version, asset) !== asset.tokenDomainSeparator.toLowerCase())) {
        blocked("The token's EIP-712 name and version do not recompute its on-chain DOMAIN_SEPARATOR.", "x402_permit2_token_domain_mismatch");
    }
    const body = { challengeHash, offerHash: selection.offerHash, policyDigest: owner.policyDigest, payer: input.payer,
        chain: asset.chain, token: asset.token, payTo: selection.payTo, amountAtomic: selection.amountAtomic,
        expiresAtUnix: plan.authorization.deadline, planHash: plan.planHash };
    return deepFreeze({ ...body, plan, prepareHash: domainHash(PREPARE_DOMAIN, canonicalJson(body)) });
}
export function hashChallenge(challenge) {
    validateChallenge(challenge);
    return domainHash("apn.x402-permit2.challenge.v1", canonicalJson(challenge));
}
/** True when the checked 402 declares a valid EIP-2612 gas-sponsoring extension. */
export function permit2SellerSponsorsEip2612(challenge) { return validateChallenge(challenge); }
function validateChallenge(challenge) {
    if (!isPlainRecord(challenge) || challenge.x402Version !== 2 || !isPlainRecord(challenge.resource) ||
        typeof challenge.resource.url !== "string" || !Array.isArray(challenge.accepts) || challenge.accepts.length === 0 ||
        Object.hasOwn(challenge, "eip2612GasSponsoring"))
        invalid("The merchant challenge is invalid.");
    if (challenge.extensions === undefined)
        return false;
    if (!isPlainRecord(challenge.extensions))
        invalid("The merchant challenge extensions are invalid.");
    if (!Object.hasOwn(challenge.extensions, "eip2612GasSponsoring"))
        return false;
    if (!isEip2612GasSponsoringDeclaration(challenge.extensions.eip2612GasSponsoring)) {
        invalid("The merchant EIP-2612 sponsorship declaration is invalid or unsupported.");
    }
    return true;
}
/** `assets` admits the offers the owner's active policy admits; the lowest-index admitted Permit2 offer is prepared. */
export async function preparePermit2WithPort(port, input) {
    const challengeHash = hashChallenge(input.challenge);
    const sellerSponsorsEip2612 = validateChallenge(input.challenge);
    const selection = selectPermit2Offer(input.challenge.accepts, input.payer, input.assets);
    if (input.expected.challengeHash !== challengeHash || input.expected.index !== selection.index ||
        canonicalJson(input.expected.requirement) !== canonicalJson(selection.requirement)) {
        blocked("The merchant challenge or selected terms changed.", "x402_permit2_merchant_terms_mismatch");
    }
    const nonce = BigInt(`0x${randomBytes(32).toString("hex")}`);
    const read = await port.read({ payer: input.payer, asset: selection.listAsset, challengeHash,
        offerHash: selection.offerHash, amountAtomic: selection.amountAtomic, nowSeconds: input.nowSeconds,
        nonceBitmapWordIndex: (nonce >> 8n).toString(), sellerSponsorsEip2612, payTo: selection.payTo });
    const { assets: _assets, ...rest } = input;
    return preparePermit2Payment({ ...rest, owner: read.owner, evidence: read.evidence, asset: read.asset, nonce });
}
function quantity(value) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value) || BigInt(value) > UINT256) {
        invalid("A prepare quantity is invalid.");
    }
    return BigInt(value);
}
function same(left, right) {
    return typeof left === "string" && /^0x[0-9a-fA-F]{40}$/u.test(left) && left.toLowerCase() === right.toLowerCase();
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", message, { reason, rail: "x402" });
}
//# sourceMappingURL=prepare.js.map