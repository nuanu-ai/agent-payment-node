import type { Address, Hex } from "../model.js";
import { conflictDomainKey, evmConflictDomain } from "../operation-conflict-domain.js";
import type { OperationService } from "../operation-service.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { mmDispatchIntent } from "./dispatch.js";
import { mmActualGross } from "./economics.js";
import type { MetaMaskGaslessState } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "./ports.js";
import { mmFail } from "./reasons.js";

/** Said once beside the listed transfers, on the approval screen and in the prepare and approve output. */
export const MM_SIBLING_WARNING = "Each earlier MetaMask gasless transfer listed here, from the same server wallet on this chain, has no proved " +
  "outcome yet and may still complete beside this one.";

/** One earlier transfer as its own record holds it: the recipient and the gross of the batch actually dispatched. */
export interface MetaMaskGaslessSiblingOutput {
  readonly operation_id: string;
  readonly state: MetaMaskGaslessState;
  readonly recipient: Address;
  readonly dispatched_gross_atomic: string;
}
export interface MetaMaskGaslessSiblingsOutput {
  readonly unresolved_beside?: { readonly operations: readonly MetaMaskGaslessSiblingOutput[]; readonly warning: string };
}

/**
 * The account's earlier MetaMask gasless transfers this one proceeds beside (see the index adapter), collected before the
 * approval screen; none of their outcomes is proved, so no amount beyond what each one dispatched is named. Empty adds nothing.
 */
export function mmSiblingsOutput(siblings: readonly MetaMaskGaslessOperationRecord[]): MetaMaskGaslessSiblingsOutput {
  return siblings.length === 0 ? {} : { unresolved_beside: { operations: siblings.map(sibling => ({ operation_id: sibling.operationId,
    state: sibling.state, recipient: sibling.intent.request.recipient, dispatched_gross_atomic: mmActualGross(mmDispatchIntent(sibling).quote) })),
  warning: MM_SIBLING_WARNING } };
}

/** A delegation hash an unresolved sibling also holds would make the two transfers' redemption proofs indistinguishable. */
export function mmAssertUniqueDelegation(delegationHash: Hex, siblings: readonly MetaMaskGaslessOperationRecord[]): void {
  if (siblings.some(sibling => [sibling.intent.delegationHash, mmDispatchIntent(sibling).delegationHash].includes(delegationHash))) {
    mmFail("mm_gasless_delegation_reused");
  }
}

/**
 * The account's earlier MetaMask gasless transfers a new one proceeds beside: the unresolved ones the operation index
 * admits, and each dispatch the owner released (`abandoned_unknown` after its one submission). A release holds no
 * account claim, but its delegation may still be redeemed, so it is listed and its hash stays unique all the same.
 */
export async function mmTransfersBeside(operations: Pick<OperationService, "metaMaskGaslessBeside">,
  records: Pick<MetaMaskGaslessRepositoryPort, "listAllOperations">, profileHash: string, chainId: number, account: Address,
  operationId: string): Promise<readonly MetaMaskGaslessOperationRecord[]> {
  const open = await operations.metaMaskGaslessBeside(profileHash, chainId, account, operationId);
  const key = conflictDomainKey(evmConflictDomain(chainId, account)), self = canonicalOperationId(operationId);
  const released = (await records.listAllOperations()).filter(record => record.state === "abandoned_unknown" &&
    record.submissionAttempts === 1 && record.operationId !== self && !open.some(other => other.operationId === record.operationId) &&
    conflictDomainKey(evmConflictDomain(record.intent.request.chainId, record.intent.binding.address)) === key)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.operationId.localeCompare(right.operationId));
  return [...open, ...released];
}
