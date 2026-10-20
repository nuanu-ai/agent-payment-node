import { encodeFunctionData } from "viem";
import { hashObject } from "../../canonical.js";
import type { Address, Hex } from "../../model.js";
import { MM_DELEGATION_PARAMETER } from "../chain/abi.js";
import type { MetaMaskGaslessIntent } from "../model.js";
import { mmRecordedDeployment } from "../recorded.js";

const DELEGATION = { name: "_delegation", type: "tuple", components: MM_DELEGATION_PARAMETER.components } as const;
const MANAGER_ABI = [
  { type: "function", name: "disableDelegation", stateMutability: "nonpayable", inputs: [DELEGATION], outputs: [] },
  { type: "function", name: "getDelegationHash", stateMutability: "pure", inputs: [DELEGATION], outputs: [{ name: "", type: "bytes32" }] },
] as const;

/** The one call that disables exactly the dispatched delegation, and the manager's own hash query for it. */
export interface MetaMaskDisableCall {
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
  /** `getDelegationHash(delegation)`: the pinned manager hashes the very tuple the call carries. */
  readonly hashQuery: Hex;
  readonly delegationHash: Hex;
  readonly callHash: string;
}

/**
 * `DelegationManager.disableDelegation(delegation)` for the delegation actually dispatched (`mmDispatchIntent`), sent
 * by its delegator, the server wallet: the manager accepts it only from that address (`onlyDeleGator`). The signature
 * field is not part of the delegation hash, so the unsigned material APN holds names the same delegation.
 */
export function mmDisableCall(dispatched: MetaMaskGaslessIntent): MetaMaskDisableCall {
  const d = dispatched.unsignedDelegation, manager = mmRecordedDeployment(dispatched).protocol.manager!.address;
  const delegation = { delegate: d.delegate, delegator: d.delegator, authority: d.authority,
    caveats: d.caveats.map(caveat => ({ enforcer: caveat.enforcer, terms: caveat.terms, args: caveat.args })),
    salt: BigInt(d.salt), signature: "0x" as Hex };
  const data = encodeFunctionData({ abi: MANAGER_ABI, functionName: "disableDelegation", args: [delegation] });
  const hashQuery = encodeFunctionData({ abi: MANAGER_ABI, functionName: "getDelegationHash", args: [delegation] });
  const from = dispatched.binding.address;
  return { from, to: manager, data, hashQuery, delegationHash: dispatched.delegationHash,
    callHash: hashObject({ purpose: "apn.metamask-gasless.disable-call.v1", chainId: dispatched.request.chainId, from, to: manager, data }) };
}
