import { concatHex, encodeAbiParameters, hashTypedData, keccak256, stringToHex } from "viem";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";
import { mmCanonicalAddress, mmExact, mmHex, mmUint } from "./validation.js";
export const MM_ANY_BENEFICIARY = "0x0000000000000000000000000000000000000a11";
export const MM_ROOT_AUTHORITY = `0x${"ff".repeat(32)}`;
export const MM_BATCH_MODE = `0x01${"00".repeat(31)}`;
export const MM_ONE_CALL_TERMS = `0x${"0".repeat(63)}1`;
export const MM_EXECUTION_ABI = [{ type: "tuple[]", components: [
            { name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" },
        ] }];
export const MM_DELEGATION_TYPES = {
    Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
    Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" },
        { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
};
const caveatTypeHash = keccak256(stringToHex("Caveat(address enforcer,bytes terms)"));
const delegationTypeHash = keccak256(stringToHex("Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"));
export function mmExactBatchTerms(input) {
    if (input.executions.length !== 2)
        mmFail("mm_gasless_quote_invalid");
    return encodeAbiParameters(MM_EXECUTION_ABI, [input.executions.map(e => ({ target: e.target,
            value: mmUint(e.value), callData: e.callData }))]);
}
function caveatHash(caveat) {
    return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }], [caveatTypeHash, caveat.enforcer, keccak256(caveat.terms)]));
}
/** Independent verifier. The official SDK creates the unsigned delegation and its CSPRNG salt. */
export function mmValidateUnsigned(value, input, reason = "mm_gasless_quote_invalid") {
    const result = mmExact(value, ["unsignedDelegation", "delegationHash", "signingDigest", "relayTo", "mode"], reason);
    const d = mmExact(result.unsignedDelegation, ["delegator", "delegate", "authority", "salt", "caveats"], reason);
    const registry = mmRegistry(input.chainId).row;
    if (mmCanonicalAddress(d.delegator, reason) !== input.owner || d.delegate !== MM_ANY_BENEFICIARY ||
        d.authority !== MM_ROOT_AUTHORITY || result.relayTo !== registry.protocol.manager.address || result.mode !== MM_BATCH_MODE)
        mmFail(reason);
    const salt = mmHex(d.salt, 32, reason);
    if (!Array.isArray(d.caveats) || d.caveats.length !== 2)
        mmFail(reason);
    const terms = mmExactBatchTerms(input);
    for (let i = 0; i < 2; i++) {
        const c = mmExact(d.caveats[i], ["enforcer", "terms", "args"], reason);
        if (c.enforcer !== (i === 0 ? registry.protocol.limitedCalls.address : registry.protocol.exactBatch.address) ||
            c.terms !== (i === 0 ? MM_ONE_CALL_TERMS : terms) || c.args !== "0x")
            mmFail(reason);
    }
    const delegation = d;
    const structHash = keccak256(encodeAbiParameters([
        { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" },
    ], [delegationTypeHash, delegation.delegate, delegation.delegator, delegation.authority,
        keccak256(concatHex(delegation.caveats.map(caveatHash))), BigInt(salt)]));
    const signingDigest = hashTypedData({ domain: { name: "DelegationManager", version: "1", chainId: input.chainId,
            verifyingContract: registry.protocol.manager.address }, types: MM_DELEGATION_TYPES, primaryType: "Delegation",
        message: { delegate: delegation.delegate, delegator: delegation.delegator, authority: delegation.authority,
            caveats: delegation.caveats.map(({ enforcer, terms: t }) => ({ enforcer, terms: t })), salt: BigInt(salt) } });
    if (mmHex(result.delegationHash, 32, reason) !== structHash || mmHex(result.signingDigest, 32, reason) !== signingDigest)
        mmFail(reason);
    return result;
}
//# sourceMappingURL=unsigned.js.map