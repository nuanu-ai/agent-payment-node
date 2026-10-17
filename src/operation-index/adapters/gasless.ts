import type { CommandOutcome } from "../../commands.js";
import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { facilitatorFail } from "../../facilitator-gasless/failure.js";
import { FacilitatorGaslessOperationRepository } from "../../facilitator-gasless/operation-repository.js";
import { FACILITATOR_TERMINAL, type FacilitatorOperationRecord } from "../../facilitator-gasless/operation-model.js";
import { publicFacilitatorOperation } from "../../facilitator-gasless/receipt.js";
import { FacilitatorGaslessService } from "../../facilitator-gasless/service.js";
import { GASLESS_TERMINAL, type GaslessOperationRecord } from "../../gasless/operation-model.js";
import { GaslessOperationRepository } from "../../gasless/operation-repository.js";
import { publicGaslessOperation } from "../../gasless/receipt.js";
import { GaslessService } from "../../gasless/service.js";
import { MetaMaskGaslessOperationRepository } from "../../metamask-gasless/journal/repository.js";
import { publicMetaMaskGaslessOperation } from "../../metamask-gasless/journal/receipt.js";
import { MM_TERMINAL, type MetaMaskGaslessOperationRecord } from "../../metamask-gasless/operation-model.js";
import { MetaMaskGaslessService } from "../../metamask-gasless/service.js";
import { abandonFacilitatorGasless, abandonLocalGasless, abandonMetaMaskGasless } from "../../operation-abandon-gasless.js";
import { abandonSmartAccountGasless } from "../../operation-abandon-provider.js";
import { assertResumeOptions, oneObservationOnly, type ResumeOptionUse } from "../../operation-command-options.js";
import { evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { SA_TERMINAL, type SmartAccountGaslessOperationRecord } from "../../smart-account-gasless/operation-model.js";
import { SmartAccountGaslessOperationRepository } from "../../smart-account-gasless/operation-repository.js";
import { OperationService } from "../../operation-service.js";
import type { RuntimeContext } from "../../runtime.js";
import { saFail } from "../../smart-account-gasless/reasons.js";
import { publicSmartAccountGaslessOperation } from "../../smart-account-gasless/receipt.js";
import { SmartAccountGaslessService } from "../../smart-account-gasless/service.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import type { OperationFamily } from "../types.js";

interface GaslessRecord { readonly profileHash: string; readonly operationId: string; readonly idempotencyHash: string;
  readonly requestHash: string; readonly state: string; readonly terminal: boolean }

/** Each gasless family's own service: status, recovery, receipt and owner exit by operation ID (built per command). */
interface GaslessCommands {
  readonly resumeOptions: ResumeOptionUse;
  status(context: RuntimeContext, operationId: string): Promise<unknown>;
  resume(context: RuntimeContext, operationId: string, observationRpcEnv: string | undefined): Promise<unknown>;
  receipt(context: RuntimeContext, operationId: string): Promise<unknown>;
  abandon(context: RuntimeContext, operationId: string): Promise<unknown>;
}

/**
 * The four gasless journals differ only in their directory, reader, outcome list (which each validator ties the record's
 * `terminal` flag to), signing-owner field, public projection and service.
 */
function gaslessAdapter<R extends GaslessRecord>(family: OperationFamily, directory: string, outcomes: () => readonly string[],
  load: (root: string, profileHash: string, operationId: string) => Promise<R | null>,
  domains: (record: R) => readonly MoneyConflictDomain[], ownerPath: readonly string[], view: (record: R) => unknown,
  commands: GaslessCommands): OperationFamilyAdapter<R> {
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
    terminal: record => outcomes().includes(record.state),
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "intent", "request", "chainId"), field(value, "intent", ...ownerPath))]),
    view: async record => view(record),
    status: async (context, record) => operationOutcome(await commands.status(context, record.operationId)),
    async resume(context, record, options): Promise<CommandOutcome> {
      assertResumeOptions(options, commands.resumeOptions);
      return operationOutcome(await commands.resume(context, record.operationId, options.observationRpcEnv));
    },
    receipt: async (context, record) => receiptOutcome(await commands.receipt(context, record.operationId)),
    abandon: async (context, record) => await commands.abandon(context, record.operationId),
  };
}
const operations = (context: RuntimeContext) => new OperationService(context.state);

export const gaslessDomains = (record: GaslessOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];
export const metaMaskGaslessDomains = (record: MetaMaskGaslessOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.binding.address)];
export const smartAccountGaslessDomains = (record: SmartAccountGaslessOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.binding.ownerAddress)];
export const facilitatorGaslessDomains = (record: FacilitatorOperationRecord): readonly MoneyConflictDomain[] =>
  [evmConflictDomain(record.intent.request.chainId, record.intent.owner.address)];

export const gaslessTransferAdapter = gaslessAdapter<GaslessOperationRecord>("gasless_transfer", "gasless-operations", () => GASLESS_TERMINAL,
  async (root, profileHash, id) => await new GaslessOperationRepository(root).loadOperation(profileHash, id),
  gaslessDomains, ["owner", "address"], publicGaslessOperation, {
    resumeOptions: { observationRpc: true, refuseWait: () => oneObservationOnly("Gasless") },
    status: async (context, id) => await new GaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new GaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new GaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonLocalGasless({ context, operations: operations(context), gasless: new GaslessService(context) }, id),
  });
export const metaMaskGaslessAdapter = gaslessAdapter<MetaMaskGaslessOperationRecord>("metamask_gasless_transfer", "metamask-gasless-operations",
  () => MM_TERMINAL,
  async (root, profileHash, id) => await new MetaMaskGaslessOperationRepository(root).loadOperation(profileHash, id),
  metaMaskGaslessDomains, ["binding", "address"], record => publicMetaMaskGaslessOperation(record), {
    resumeOptions: { observationRpc: true, refuseWait: () => {
      throw new ApnError("APN_INVALID_INPUT", "MetaMask gasless recovery performs one bounded observation; omit --wait-seconds.", { reason: "mm_gasless_input" });
    } },
    status: async (context, id) => await new MetaMaskGaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new MetaMaskGaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new MetaMaskGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonMetaMaskGasless({ context, operations: operations(context),
      metaMaskGasless: new MetaMaskGaslessService(context) }, id),
  });
export const smartAccountGaslessAdapter = gaslessAdapter<SmartAccountGaslessOperationRecord>("smart_account_gasless_transfer",
  "smart-account-gasless-operations", () => SA_TERMINAL,
  async (root, profileHash, id) => await new SmartAccountGaslessOperationRepository(root).loadOperation(profileHash, id),
  smartAccountGaslessDomains, ["binding", "ownerAddress"], publicSmartAccountGaslessOperation, {
    resumeOptions: { observationRpc: true, refuseWait: () => saFail("sa_gasless_input") },
    status: async (context, id) => await new SmartAccountGaslessService(context).status(id),
    resume: async (context, id, observationRpcEnv) => await new SmartAccountGaslessService(context).resume(id, observationRpcEnv),
    receipt: async (context, id) => await new SmartAccountGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonSmartAccountGasless(context, operations(context), id),
  });
export const facilitatorGaslessAdapter = gaslessAdapter<FacilitatorOperationRecord>("facilitator_gasless_transfer",
  "facilitator-gasless-operations", () => FACILITATOR_TERMINAL,
  async (root, profileHash, id) => await new FacilitatorGaslessOperationRepository(root).loadOperation(profileHash, id),
  facilitatorGaslessDomains, ["owner", "address"], publicFacilitatorOperation, {
    resumeOptions: { refuseWait: () => facilitatorFail("facilitator_gasless_input") },
    status: async (context, id) => await new FacilitatorGaslessService(context).status(id),
    resume: async (context, id) => await new FacilitatorGaslessService(context).resume(id),
    receipt: async (context, id) => await new FacilitatorGaslessService(context).receipt(id),
    abandon: async (context, id) => await abandonFacilitatorGasless({ context, operations: operations(context),
      facilitatorGasless: new FacilitatorGaslessService(context) }, id),
  });
