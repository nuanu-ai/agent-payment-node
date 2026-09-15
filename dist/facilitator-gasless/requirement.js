import { randomBytes } from "node:crypto";
import { hashTypedData } from "viem";
import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const ATOMIC = /^[1-9][0-9]{0,77}$/u;
export function facilitatorRequirement(recipient, amountAtomic) {
    if (!ADDRESS.test(recipient) || !ATOMIC.test(amountAtomic))
        invalid();
    return { scheme: "exact", network: R.network, amount: amountAtomic, asset: R.token, payTo: recipient,
        maxTimeoutSeconds: R.maxTimeoutSeconds, extra: { assetTransferMethod: "eip3009", ...R.tokenDomain } };
}
/** A fresh random nonce and a validity window that starts now; nothing is signed here. */
export function newFacilitatorAuthorization(owner, requirement, nowMs, nonce = `0x${randomBytes(32).toString("hex")}`) {
    if (!ADDRESS.test(owner) || owner === requirement.payTo || !Number.isSafeInteger(nowMs) || !/^0x[0-9a-f]{64}$/u.test(nonce))
        invalid();
    const validBefore = Math.floor(nowMs / 1000) + R.validitySeconds;
    return { from: owner, to: requirement.payTo, value: requirement.amount, validAfter: "0",
        validBefore: String(validBefore), nonce };
}
/** The EIP-712 message the owner signs: Circle `TransferWithAuthorization` on native Avalanche USDC. */
export function facilitatorTypedData(authorization) {
    return {
        domain: { name: R.tokenDomain.name, version: R.tokenDomain.version, chainId: R.chainId, verifyingContract: R.token },
        types: { TransferWithAuthorization: [
                { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
            ] },
        primaryType: "TransferWithAuthorization",
        message: { from: authorization.from, to: authorization.to, value: BigInt(authorization.value), validAfter: 0n,
            validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
    };
}
export function facilitatorAuthorizationDigest(authorization) {
    return hashTypedData(facilitatorTypedData(authorization));
}
export function facilitatorRequirementHash(requirement) {
    return domainHash("apn.facilitator-gasless.requirement.v1", canonicalJson(requirement));
}
function invalid() {
    throw new ApnError("APN_INVALID_INPUT", "Avalanche facilitator transfer input is invalid.", { reason: "facilitator_gasless_input" });
}
//# sourceMappingURL=requirement.js.map