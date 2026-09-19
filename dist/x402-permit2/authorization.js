import { recoverTypedDataAddress } from "viem";
import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./registry.js";
const PLAN_DOMAIN = "apn.x402-permit2.plan.v1";
const MAX_UINT256 = (1n << 256n) - 1n;
export const EIP2612_GAS_SPONSORING = "eip2612GasSponsoring";
/** Must equal the x402 exact proxy's witness layout; the test suite cross-checks it against @x402/evm. */
export const PERMIT2_WITNESS_TYPES = {
    PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" }, { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }, { name: "witness", type: "Witness" },
    ],
    TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    Witness: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }],
};
export const EIP2612_PERMIT_TYPES = {
    Permit: [
        { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ],
};
export function planPermit2Authorization(selection, input) {
    if (typeof input.payer !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(input.payer) || input.payer.toLowerCase() === selection.payTo.toLowerCase()) {
        invalid("The payer must be an exact EVM address other than the payee.");
    }
    if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1)
        invalid("The signing instant is invalid.");
    if (typeof input.nonce !== "bigint" || input.nonce < 0n || input.nonce > MAX_UINT256)
        invalid("The Permit2 nonce is invalid.");
    if (!/^(0|[1-9][0-9]{0,77})$/u.test(input.permit2AllowanceAtomic))
        invalid("The observed Permit2 allowance is invalid.");
    const { listAsset } = selection;
    const deadline = String(input.nowSeconds + selection.maxTimeoutSeconds);
    const authorization = {
        from: input.payer,
        permitted: { token: listAsset.token, amount: selection.amountAtomic },
        spender: X402_EXACT_PERMIT2_PROXY,
        nonce: input.nonce.toString(),
        deadline,
        witness: { to: selection.payTo, validAfter: "0" },
    };
    const permit2 = {
        domain: { name: "Permit2", chainId: listAsset.chainId, verifyingContract: PERMIT2_ADDRESS },
        types: PERMIT2_WITNESS_TYPES,
        primaryType: "PermitWitnessTransferFrom",
        message: {
            permitted: { token: listAsset.token, amount: BigInt(selection.amountAtomic) }, spender: X402_EXACT_PERMIT2_PROXY,
            nonce: input.nonce, deadline: BigInt(deadline), witness: { to: selection.payTo, validAfter: 0n },
        },
    };
    let eip2612 = null;
    if (BigInt(input.permit2AllowanceAtomic) < BigInt(selection.amountAtomic)) {
        if (!input.sellerSponsorsEip2612) {
            throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "Permit2 lacks allowance and the seller does not sponsor an EIP-2612 permit.", { reason: "x402_permit2_allowance_required", rail: "x402" });
        }
        if (typeof input.eip2612Nonce !== "bigint" || input.eip2612Nonce < 0n || input.eip2612Nonce > MAX_UINT256)
            invalid("The token permit nonce is invalid.");
        const info = { from: input.payer, asset: listAsset.token, spender: PERMIT2_ADDRESS, amount: selection.amountAtomic,
            nonce: input.eip2612Nonce.toString(), deadline, version: "1" };
        eip2612 = { info, typedData: {
                domain: { name: listAsset.tokenDomain.name, version: listAsset.tokenDomain.version, chainId: listAsset.chainId, verifyingContract: listAsset.token },
                types: EIP2612_PERMIT_TYPES,
                primaryType: "Permit",
                // Exactly the payment amount, never an unlimited approval.
                message: { owner: input.payer, spender: PERMIT2_ADDRESS, value: BigInt(selection.amountAtomic), nonce: input.eip2612Nonce, deadline: BigInt(deadline) },
            } };
    }
    const planHash = domainHash(PLAN_DOMAIN, canonicalJson({ offerHash: selection.offerHash, index: selection.index, authorization,
        eip2612: eip2612?.info ?? null }));
    return { selection, authorization, permit2, eip2612, planHash };
}
/** Recover the payer from a frozen typed-data/signature pair without signing or sending anything. */
export async function recoverPermit2Payer(typedData, signature) {
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(signature)) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "The supplied signature is malformed.");
    }
    try {
        return await recoverTypedDataAddress({ ...typedData, signature });
    }
    catch {
        throw new ApnError("APN_NATIVE_PROTOCOL", "The supplied signature does not recover.");
    }
}
/** Verify that a supplied signature recovers to the frozen payer. */
export async function verifyPermit2PayerSignature(typedData, signature, payer) {
    const recovered = await recoverPermit2Payer(typedData, signature);
    if (recovered.toLowerCase() !== payer.toLowerCase())
        throw new ApnError("APN_WALLET_MISMATCH", "The signature is not the frozen payer's.");
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
//# sourceMappingURL=authorization.js.map