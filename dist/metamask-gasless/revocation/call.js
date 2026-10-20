import { encodeFunctionData } from "viem";
import { hashObject } from "../../canonical.js";
import { MM_DELEGATION_PARAMETER } from "../chain/abi.js";
import { mmRecordedDeployment } from "../recorded.js";
const DELEGATION = { name: "_delegation", type: "tuple", components: MM_DELEGATION_PARAMETER.components };
const MANAGER_ABI = [
    { type: "function", name: "disableDelegation", stateMutability: "nonpayable", inputs: [DELEGATION], outputs: [] },
    { type: "function", name: "getDelegationHash", stateMutability: "pure", inputs: [DELEGATION], outputs: [{ name: "", type: "bytes32" }] },
];
/**
 * `DelegationManager.disableDelegation(delegation)` for the delegation actually dispatched (`mmDispatchIntent`), sent
 * by its delegator, the server wallet: the manager accepts it only from that address (`onlyDeleGator`). The signature
 * field is not part of the delegation hash, so the unsigned material APN holds names the same delegation.
 */
export function mmDisableCall(dispatched) {
    const d = dispatched.unsignedDelegation, manager = mmRecordedDeployment(dispatched).protocol.manager.address;
    const delegation = { delegate: d.delegate, delegator: d.delegator, authority: d.authority,
        caveats: d.caveats.map(caveat => ({ enforcer: caveat.enforcer, terms: caveat.terms, args: caveat.args })),
        salt: BigInt(d.salt), signature: "0x" };
    const data = encodeFunctionData({ abi: MANAGER_ABI, functionName: "disableDelegation", args: [delegation] });
    const hashQuery = encodeFunctionData({ abi: MANAGER_ABI, functionName: "getDelegationHash", args: [delegation] });
    const from = dispatched.binding.address;
    return { from, to: manager, data, hashQuery, delegationHash: dispatched.delegationHash,
        callHash: hashObject({ purpose: "apn.metamask-gasless.disable-call.v1", chainId: dispatched.request.chainId, from, to: manager, data }) };
}
//# sourceMappingURL=call.js.map