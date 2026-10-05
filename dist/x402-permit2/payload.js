import { isPermit2Payload } from "@x402/evm";
import { hashTypedData } from "viem";
import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import { encodePermit2PaymentSignatureHeader, decodePermit2PaymentSignatureHeader } from "../x402-codec.js";
import { verifyPermit2PayerSignature, planPermit2Authorization } from "./authorization.js";
import { validatePermit2ExecutionIntent } from "./execution-intent.js";
import { selectPermit2Offer } from "./offer.js";
import { hashChallenge } from "./prepare.js";
/** Pure assembly of already signed, immutable material. This does not reserve, sign, or submit a payment. */
export async function assemblePermit2PaymentPayload(input) {
    const { intent, prepared, challenge } = input;
    validatePermit2ExecutionIntent(intent, intent.operationId);
    if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1 ||
        BigInt(input.nowSeconds) >= BigInt(intent.deadline))
        refuse("The Permit2 deadline has expired.");
    if (challenge.resource.url !== intent.resourceUrl || hashChallenge(challenge) !== intent.challengeHash ||
        prepared.challengeHash !== intent.challengeHash || prepared.policyDigest !== intent.policyDigest ||
        prepared.prepareHash !== intent.prepareHash)
        refuse("The challenge or prepared material changed.");
    const selection = selectPermit2Offer(challenge.accepts, prepared.payer);
    const plan = prepared.plan;
    if (selection.index !== plan.selection.index || selection.offerHash !== plan.selection.offerHash ||
        canonicalJson(selection) !== canonicalJson(plan.selection) || prepared.offerHash !== selection.offerHash) {
        refuse("The selected merchant requirement changed.");
    }
    const signingSecond = Number(BigInt(intent.deadline) - BigInt(selection.maxTimeoutSeconds));
    if (!Number.isSafeInteger(signingSecond) || signingSecond < 1)
        refuse("The signing time is invalid.");
    const rebuilt = planPermit2Authorization(selection, {
        payer: prepared.payer, nowSeconds: signingSecond, nonce: BigInt(intent.nonce),
        permit2AllowanceAtomic: plan.eip2612 === null ? selection.amountAtomic : "0",
        eip2612Nonce: plan.eip2612 === null ? null : BigInt(plan.eip2612.info.nonce),
        sellerSponsorsEip2612: plan.eip2612 !== null,
    });
    if (snapshot(rebuilt) !== snapshot(plan) ||
        prepared.chain !== intent.chain || prepared.token !== intent.token ||
        prepared.payer !== intent.owner || prepared.payTo !== intent.recipient ||
        prepared.amountAtomic !== intent.amountAtomic || prepared.expiresAtUnix !== intent.deadline ||
        plan.authorization.nonce !== intent.nonce || plan.authorization.deadline !== intent.deadline ||
        plan.permit2.domain.verifyingContract !== intent.permit2Contract ||
        plan.authorization.spender !== intent.exactProxy)
        refuse("The frozen Permit2 binding changed.");
    const preparedBody = { challengeHash: prepared.challengeHash, offerHash: prepared.offerHash,
        policyDigest: prepared.policyDigest, payer: prepared.payer, chain: prepared.chain,
        token: prepared.token, payTo: prepared.payTo, amountAtomic: prepared.amountAtomic,
        expiresAtUnix: prepared.expiresAtUnix, planHash: plan.planHash };
    if (domainHash("apn.x402-permit2.prepare.v1", canonicalJson(preparedBody)) !== prepared.prepareHash ||
        hashTypedData(plan.permit2) !== intent.typedDataDigest ||
        (plan.eip2612 === null ? null : hashTypedData(plan.eip2612.typedData)) !== intent.eip2612Digest) {
        refuse("Prepared material or typed data digest changed.");
    }
    if ((plan.eip2612 === null) !== (input.eip2612Signature === undefined) ||
        (plan.eip2612 !== null && challenge.extensions?.eip2612GasSponsoring === undefined)) {
        refuse("The EIP-2612 signature does not match the required plan.");
    }
    await verifyPermit2PayerSignature(plan.permit2, input.permit2Signature, prepared.payer);
    if (plan.eip2612 !== null) {
        await verifyPermit2PayerSignature(plan.eip2612.typedData, input.eip2612Signature, prepared.payer);
    }
    const evmPayload = { signature: input.permit2Signature,
        permit2Authorization: { ...plan.authorization } };
    if (!isPermit2Payload(evmPayload))
        refuse("The exact Permit2 payload is invalid.");
    const payload = {
        x402Version: 2, resource: challenge.resource,
        accepted: selection.requirement, payload: evmPayload,
        ...(plan.eip2612 === null ? {} : { extensions: { eip2612GasSponsoring: {
                    info: { ...plan.eip2612.info, signature: input.eip2612Signature },
                } } }),
    };
    const paymentSignatureHeader = encodePermit2PaymentSignatureHeader(payload);
    if (canonicalJson(decodePermit2PaymentSignatureHeader(paymentSignatureHeader)) !== canonicalJson(payload)) {
        refuse("The official x402 decoder disagrees with the payment payload.");
    }
    return { payload, paymentSignatureHeader };
}
function refuse(message) {
    throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "x402_permit2_payload_mismatch" });
}
function snapshot(value) {
    return canonicalJson(JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)));
}
//# sourceMappingURL=payload.js.map