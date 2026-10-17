import { FacilitatorGaslessOperationRepository } from "../../facilitator-gasless/operation-repository.js";
import type { FacilitatorOperationRecord } from "../../facilitator-gasless/operation-model.js";
import { publicFacilitatorOperation } from "../../facilitator-gasless/receipt.js";
import type { GaslessOperationRecord } from "../../gasless/operation-model.js";
import { GaslessOperationRepository } from "../../gasless/operation-repository.js";
import { publicGaslessOperation } from "../../gasless/receipt.js";
import { MetaMaskGaslessOperationRepository } from "../../metamask-gasless/journal/repository.js";
import { publicMetaMaskGaslessOperation } from "../../metamask-gasless/journal/receipt.js";
import type { MetaMaskGaslessOperationRecord } from "../../metamask-gasless/operation-model.js";
import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import type { SmartAccountGaslessOperationRecord } from "../../smart-account-gasless/operation-model.js";
import { SmartAccountGaslessOperationRepository } from "../../smart-account-gasless/operation-repository.js";
import { publicSmartAccountGaslessOperation } from "../../smart-account-gasless/receipt.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import type { OperationFamily } from "../types.js";

interface GaslessRecord { readonly profileHash: string; readonly operationId: string; readonly idempotencyHash: string;
  readonly requestHash: string; readonly state: string; readonly terminal: boolean }

/** The four gasless journals differ only in their directory, reader, signing-owner field and public projection. */
function gaslessAdapter<R extends GaslessRecord>(family: OperationFamily, directory: string,
  load: (root: string, profileHash: string, operationId: string) => Promise<R | null>,
  domains: (record: R) => readonly MoneyConflictDomain[], ownerPath: readonly string[], view: (record: R) => unknown): OperationFamilyAdapter<R> {
  const store: OperationStore = { directory, perProfile: true };
  return {
    family,
    stores: [store],
    async load(root, recordPath) {
      const { profileHash, operationId } = requiredRecordPath(recordPath, store);
      return await load(root, profileHash!, operationId);
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims(domains(record))),
    terminal: record => record.terminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "intent", "request", "chainId"), field(value, "intent", ...ownerPath))]),
    view: async record => view(record),
  };
}

export const gaslessDomains = (record: GaslessOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];
export const metaMaskGaslessDomains = (record: MetaMaskGaslessOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.binding.address)];
export const smartAccountGaslessDomains = (record: SmartAccountGaslessOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.binding.ownerAddress)];
export const facilitatorGaslessDomains = (record: FacilitatorOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];

export const gaslessTransferAdapter = gaslessAdapter<GaslessOperationRecord>("gasless_transfer", "gasless-operations",
  async (root, profileHash, id) => await new GaslessOperationRepository(root).loadOperation(profileHash, id),
  gaslessDomains, ["owner", "address"], publicGaslessOperation);
export const metaMaskGaslessAdapter = gaslessAdapter<MetaMaskGaslessOperationRecord>("metamask_gasless_transfer", "metamask-gasless-operations",
  async (root, profileHash, id) => await new MetaMaskGaslessOperationRepository(root).loadOperation(profileHash, id),
  metaMaskGaslessDomains, ["binding", "address"], record => publicMetaMaskGaslessOperation(record));
export const smartAccountGaslessAdapter = gaslessAdapter<SmartAccountGaslessOperationRecord>("smart_account_gasless_transfer",
  "smart-account-gasless-operations",
  async (root, profileHash, id) => await new SmartAccountGaslessOperationRepository(root).loadOperation(profileHash, id),
  smartAccountGaslessDomains, ["binding", "ownerAddress"], publicSmartAccountGaslessOperation);
export const facilitatorGaslessAdapter = gaslessAdapter<FacilitatorOperationRecord>("facilitator_gasless_transfer",
  "facilitator-gasless-operations",
  async (root, profileHash, id) => await new FacilitatorGaslessOperationRepository(root).loadOperation(profileHash, id),
  facilitatorGaslessDomains, ["owner", "address"], publicFacilitatorOperation);
