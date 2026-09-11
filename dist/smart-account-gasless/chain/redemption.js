import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, parseAbi } from "viem";
import { saFail } from "../reasons.js";
import { saHash, saHex } from "../schema.js";
import { saRegistry } from "../registry.js";
import { SA_DELEGATION_ARRAY_PARAMETER, SA_REDEEM_SELECTOR, SA_SINGLE_DEFAULT, SA_TRANSFER_SELECTOR, rpcAddress, rpcHex } from "./abi.js";
const REDEEM_ABI = parseAbi([
    "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
/** Decode canonical one-context redemption and delegate all cryptographic caveat validation to the neutral port. */
export async function verifySmartAccountRedemption(calldataInput, operationId, fingerprint, intent, material, validator) {
    const calldata = rpcHex(calldataInput, 64 * 1024);
    if (!calldata.startsWith(SA_REDEEM_SELECTOR))
        saFail("sa_gasless_evidence");
    let values;
    try {
        const decoded = decodeFunctionData({ abi: REDEEM_ABI, data: calldata });
        if (decoded.functionName !== "redeemDelegations")
            saFail("sa_gasless_evidence");
        values = decoded.args;
    }
    catch {
        return saFail("sa_gasless_evidence");
    }
    const [contexts, modes, executions] = values;
    if (contexts.length !== 1 || modes.length !== 1 || executions.length !== 1)
        saFail("sa_gasless_evidence");
    const permissionContext = rpcHex(contexts[0], 64 * 1024);
    const mode = rpcHex(modes[0], 32, 32), executionCallData = rpcHex(executions[0], 1024);
    if (mode !== SA_SINGLE_DEFAULT)
        saFail("sa_gasless_evidence");
    validateExecution(executionCallData, intent);
    let chain;
    try {
        const decoded = decodeAbiParameters([SA_DELEGATION_ARRAY_PARAMETER], permissionContext)[0];
        if (encodeAbiParameters([SA_DELEGATION_ARRAY_PARAMETER], [decoded]) !== permissionContext) {
            saFail("sa_gasless_evidence");
        }
        chain = decoded;
    }
    catch {
        return saFail("sa_gasless_evidence");
    }
    if (chain.length !== 2 || chain[0] === undefined || chain[1] === undefined)
        saFail("sa_gasless_evidence");
    const child = canonicalDelegation(chain[0]), root = canonicalDelegation(chain[1]);
    const rootContext = encodeAbiParameters([SA_DELEGATION_ARRAY_PARAMETER], [[root]]);
    const paymentPayload = { x402Version: 2, accepted: intent.requirements,
        payload: { delegationManager: intent.binding.delegationManager, delegator: intent.binding.ownerAddress,
            permissionContext } };
    let hashes;
    try {
        hashes = await validator.validate({ operationId, fingerprint, intent, paymentPayload, rootContext });
    }
    catch {
        return saFail("sa_gasless_evidence");
    }
    const expected = {
        encodedRootHash: material.encodedRootHash, encodedChildHash: material.encodedChildHash,
        permissionContextHash: material.permissionContextHash, payloadHash: material.payloadHash,
        requirementsHash: material.requirementsHash, materialHash: material.materialHash,
        rootDelegationHash: material.rootDelegationHash, childDelegationHash: material.childDelegationHash,
    };
    for (const name of ["encodedRootHash", "encodedChildHash", "permissionContextHash", "payloadHash",
        "requirementsHash", "materialHash"]) {
        if (saHash(hashes[name]) !== expected[name])
            saFail("sa_gasless_evidence");
    }
    if (saHex(hashes.rootDelegationHash, 32) !== expected.rootDelegationHash ||
        saHex(hashes.childDelegationHash, 32) !== expected.childDelegationHash ||
        hashes.encodedRootHash !== intent.binding.encodedRootHash ||
        hashes.rootDelegationHash !== intent.binding.rootDelegationHash)
        saFail("sa_gasless_evidence");
    const canonical = encodeFunctionData({ abi: REDEEM_ABI, functionName: "redeemDelegations",
        args: [[permissionContext], [SA_SINGLE_DEFAULT], [executionCallData]] });
    if (canonical !== calldata)
        saFail("sa_gasless_evidence");
    return { calldata, permissionContext, rootContext, child, root,
        childDelegationHash: material.childDelegationHash, executionCallData, paymentPayload };
}
function validateExecution(value, intent) {
    // SingleDefault execution calldata is abi.encodePacked(address,uint256,bytes).
    if (value.length !== 2 + (20 + 32 + 68) * 2)
        saFail("sa_gasless_evidence");
    const target = rpcAddress(`0x${value.slice(2, 42)}`), callValue = BigInt(`0x${value.slice(42, 106)}`);
    const callData = `0x${value.slice(106)}`, registry = saRegistry(8453);
    if (target !== registry.token.address || callValue !== 0n || !callData.startsWith(SA_TRANSFER_SELECTOR) ||
        callData.length !== 2 + 68 * 2 || rpcAddress(`0x${callData.slice(34, 74)}`) !== intent.request.recipient ||
        BigInt(`0x${callData.slice(74, 138)}`) !== BigInt(intent.request.grossAtomic))
        saFail("sa_gasless_evidence");
    if (callData.slice(10, 34) !== "0".repeat(24))
        saFail("sa_gasless_evidence");
}
function canonicalDelegation(value) {
    if (value.caveats.length > 16 || value.salt < 0n || value.salt >= 1n << 256n)
        saFail("sa_gasless_evidence");
    return { delegate: decodedAddress(value.delegate), delegator: decodedAddress(value.delegator),
        authority: rpcHex(value.authority, 32, 32),
        caveats: value.caveats.map(caveat => ({ enforcer: decodedAddress(caveat.enforcer),
            terms: rpcHex(caveat.terms, 64 * 1024), args: rpcHex(caveat.args, 64 * 1024) })),
        salt: value.salt, signature: rpcHex(value.signature, 4096) };
}
function decodedAddress(value) {
    try {
        return getAddress(value).toLowerCase();
    }
    catch {
        return saFail("sa_gasless_evidence");
    }
}
//# sourceMappingURL=redemption.js.map