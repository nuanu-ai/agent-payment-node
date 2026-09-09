import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, recoverAddress } from "viem";
import { mmFail } from "../reasons.js";
import { mmExactBatchTerms, mmValidateUnsigned } from "../unsigned.js";
import { mmAddress, mmHex } from "../validation.js";
import { MM_DELEGATION_PARAMETER, MM_REDEEM_SELECTOR } from "./abi.js";
const REDEEM_ABI = parseAbi([
    "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;
/** Decode and independently authenticate the one-root MetaMask delegation redemption. */
export async function verifyRedemption(calldataInput, intent) {
    const calldata = mmHex(calldataInput, undefined, "mm_gasless_evidence_invalid", 256 * 1024);
    if (!calldata.startsWith(MM_REDEEM_SELECTOR))
        mmFail("mm_gasless_evidence_invalid");
    let functionName, args;
    try {
        const decoded = decodeFunctionData({ abi: REDEEM_ABI, data: calldata });
        functionName = decoded.functionName;
        args = decoded.args;
    }
    catch {
        return mmFail("mm_gasless_evidence_invalid");
    }
    if (functionName !== "redeemDelegations" || args === undefined)
        mmFail("mm_gasless_evidence_invalid");
    const [contextsValue, modesValue, executionsValue] = args;
    if (!Array.isArray(contextsValue) || contextsValue.length !== 1 || !Array.isArray(modesValue) ||
        modesValue.length !== 1 || !Array.isArray(executionsValue) || executionsValue.length !== 1) {
        mmFail("mm_gasless_evidence_invalid");
    }
    const context = mmHex(contextsValue[0], undefined, "mm_gasless_evidence_invalid", 128 * 1024);
    const mode = mmHex(modesValue[0], 32, "mm_gasless_evidence_invalid");
    const executionCallData = mmHex(executionsValue[0], undefined, "mm_gasless_evidence_invalid", 64 * 1024);
    if (mode !== intent.mode || executionCallData !== mmExactBatchTerms({ owner: intent.binding.address,
        chainId: intent.request.chainId, executions: intent.quote.executions }))
        mmFail("mm_gasless_evidence_invalid");
    let decodedDelegations;
    try {
        const decoded = decodeAbiParameters([MM_DELEGATION_PARAMETER], context)[0];
        decodedDelegations = decoded;
        if (encodeAbiParameters([MM_DELEGATION_PARAMETER], [decoded]) !== context)
            mmFail("mm_gasless_evidence_invalid");
    }
    catch {
        return mmFail("mm_gasless_evidence_invalid");
    }
    if (decodedDelegations.length !== 1)
        mmFail("mm_gasless_evidence_invalid");
    const signed = decodedDelegations[0];
    if (signed.caveats.length !== 2 || signed.salt < 0n || signed.salt >= 1n << 256n) {
        mmFail("mm_gasless_evidence_invalid");
    }
    const caveats = signed.caveats.map((caveat) => ({
        enforcer: mmAddress(caveat.enforcer, "mm_gasless_evidence_invalid"),
        terms: mmHex(caveat.terms, undefined, "mm_gasless_evidence_invalid", 64 * 1024),
        args: mmHex(caveat.args, undefined, "mm_gasless_evidence_invalid", 64 * 1024),
    }));
    const unsignedDelegation = {
        delegate: mmAddress(signed.delegate, "mm_gasless_evidence_invalid"),
        delegator: mmAddress(signed.delegator, "mm_gasless_evidence_invalid"),
        authority: mmHex(signed.authority, 32, "mm_gasless_evidence_invalid"),
        salt: `0x${signed.salt.toString(16).padStart(64, "0")}`,
        caveats: caveats,
    };
    mmValidateUnsigned({ unsignedDelegation, delegationHash: intent.delegationHash,
        signingDigest: intent.signingDigest, relayTo: intent.relayTo, mode: intent.mode }, { owner: intent.binding.address, chainId: intent.request.chainId, executions: intent.quote.executions }, "mm_gasless_evidence_invalid");
    const signature = canonicalSignature(signed.signature);
    let signer;
    try {
        signer = (await recoverAddress({ hash: intent.signingDigest, signature })).toLowerCase();
    }
    catch {
        return mmFail("mm_gasless_evidence_invalid");
    }
    if (signer !== intent.binding.address)
        mmFail("mm_gasless_evidence_invalid");
    const canonical = encodeFunctionData({ abi: REDEEM_ABI, functionName: "redeemDelegations",
        args: [[context], [mode], [executionCallData]] });
    if (canonical !== calldata)
        mmFail("mm_gasless_evidence_invalid");
    return { calldata, signature, executionCallData };
}
function canonicalSignature(value) {
    const signature = mmHex(value, 65, "mm_gasless_evidence_invalid");
    const r = BigInt(`0x${signature.slice(2, 66)}`), s = BigInt(`0x${signature.slice(66, 130)}`);
    const v = signature.slice(130);
    if (r === 0n || r >= CURVE_ORDER || s === 0n || s > HALF_CURVE_ORDER || (v !== "1b" && v !== "1c")) {
        mmFail("mm_gasless_evidence_invalid");
    }
    return signature;
}
//# sourceMappingURL=delegation.js.map