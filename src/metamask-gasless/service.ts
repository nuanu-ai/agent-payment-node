import { mmObservationRpcEnv } from "./chain/rpc.js";
import type { MetaMaskGaslessObservationRpcFactory } from "./ports.js";
import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { MetaMaskGaslessClock } from "./clock.js";
import { MetaMaskGaslessExecution } from "./execution.js";
import { MetaMaskGaslessOperationRepository } from "./journal/repository.js";
import { publicMetaMaskGaslessOperation } from "./journal/receipt.js";
import { advanceMetaMaskGaslessOperation } from "./journal/transitions.js";
import type { MetaMaskGaslessChainId } from "./model.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import type { MetaMaskGaslessStep } from "./observation.js";
import { metaMaskGaslessOwner } from "./owner.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort,
  MetaMaskGaslessRepositoryPort, MetaMaskGaslessRpcFactory } from "./ports.js";
import { MetaMaskGaslessPreparation } from "./prepare.js";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";
import { mmChain } from "./validation.js";
import { canonicalProfile } from "../wallet-policy.js";

export interface MetaMaskGaslessDependencies {
  readonly rpcFor: MetaMaskGaslessRpcFactory;
  readonly observationRpcFor?: MetaMaskGaslessObservationRpcFactory;
  readonly provider: MetaMaskGaslessProviderPort;
  readonly approval?: MetaMaskGaslessApprovalPort;
  readonly records?: MetaMaskGaslessRepositoryPort;
}
export class MetaMaskGaslessService {
  readonly records: MetaMaskGaslessRepositoryPort;
  readonly operations: OperationService;
  constructor(private readonly context: RuntimeContext) {
    this.records = context.metaMaskGasless?.records ?? new MetaMaskGaslessOperationRepository(context.state.root);
    this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, undefined, this.records);
  }
  async balance(profile: string, chainId: MetaMaskGaslessChainId) {
    const { row } = mmRegistry(mmChain(chainId)), clock = new MetaMaskGaslessClock(this.context.clock); clock.check();
    const owner = await metaMaskGaslessOwner(this.context.state, profile); clock.check();
    const rpc = this.dependencies().rpcFor(chainId);
    if (rpc.chainId !== chainId) mmFail("mm_gasless_rpc_binding");
    const balance = await rpc.balance(owner.address); clock.check(undefined, [balance.observedAt]);
    if (balance.chainId !== chainId || balance.endpointHash !== rpc.endpointHash || balance.endpointOrigin !== rpc.endpointOrigin) {
      mmFail("mm_gasless_rpc_binding");
    }
    return { profile: owner.profile, provider: "metamask-agent-wallet", chain_id: chainId,
      token: row.token, symbol: "USDC", decimals: 6, address: owner.address, balance_atomic: balance.state.usdcBalanceAtomic,
      designation: balance.state.designation, block: balance.block, observed_at: balance.observedAt,
      rpc_origin: balance.endpointOrigin, endpoint_hash: balance.endpointHash,
      sender_native_balance_required: false, proof_class: "chain_verified_public_read" };
  }
  async prepare(input: Parameters<MetaMaskGaslessPreparation["prepare"]>[0]) {
    const d = this.dependencies();
    const preparation = new MetaMaskGaslessPreparation({ state: this.context.state, records: this.records,
      operations: this.operations, rpcFor: d.rpcFor, provider: d.provider, clock: this.context.clock, ids: this.context.ids });
    try { return publicMetaMaskGaslessOperation(await preparation.prepare(input)); }
    catch (error) { throw await this.sessionGuidance(error, input.profile); }
  }
  /**
   * A lost provider session is normally renewed with the foreground wallet connect handoff, but wallet lifecycle
   * changes wait for every unresolved operation of the profile. Point at the operation that holds the profile instead
   * of at a command that would only be refused.
   */
  private async sessionGuidance(error: unknown, profileInput: string): Promise<unknown> {
    if (!(error instanceof ApnError) || error.code !== "APN_PROVIDER_SESSION_REQUIRED") return error;
    let blocking: string;
    try {
      await this.operations.assertProfileAvailable(this.context.state.profileHash(canonicalProfile(profileInput)));
      return error;
    } catch (guard) {
      if (!(guard instanceof ApnError) || guard.code !== "APN_OPERATION_BLOCKED" ||
        typeof guard.details?.blockingOperationId !== "string") return error;
      blocking = guard.details.blockingOperationId;
    }
    return new ApnError(error.code, error.message, { ...error.details, blockingOperationId: blocking, nextActions: [
      `apn operation status --operation ${blocking}`,
      `Wallet connect for this profile waits until operation ${blocking} is terminal. Follow its next actions; if its outcome is still unknown after its approval window, release it with apn operation abandon --operation ${blocking}. Then run the foreground wallet connect handoff again.`,
    ] });
  }
  async approve(operationId: string) {
    return await this.locked(operationId, async op => {
      if (op.terminal || op.state !== "awaiting_approval") return publicMetaMaskGaslessOperation(op);
      const approval = this.dependencies().approval;
      if (approval === undefined) throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this MetaMask USDC transfer in a foreground terminal.", {
        reason: "mm_gasless_approval", nextActions: [`apn gasless transfer approve --operation ${op.operationId}`],
      });
      return this.project(await this.execution().approve(op, approval));
    });
  }
  async resume(operationId: string, observationRpcEnv?: string) {
    const environmentName = observationRpcEnv === undefined ? undefined : mmObservationRpcEnv(observationRpcEnv);
    return await this.locked(operationId, async op => {
      if (op.terminal || op.state === "awaiting_approval") return publicMetaMaskGaslessOperation(op);
      if (environmentName === undefined) return this.project(await this.execution().run(op));
      const factory = this.dependencies().observationRpcFor;
      if (factory === undefined) return mmFail("mm_gasless_rpc_binding");
      return this.project(await this.execution().observeWith(op,
        { rpc: factory(op.intent.request.chainId, environmentName), environmentName }));
    });
  }
  async status(operationId: string) {
    return await this.locked(operationId, async op => publicMetaMaskGaslessOperation(op));
  }
  async receipt(operationId: string) {
    return await this.locked(operationId, async op => await this.records.loadReceipt(op.profileHash, op.operationId));
  }
  private project(step: MetaMaskGaslessStep) {
    const result = publicMetaMaskGaslessOperation(step.operation);
    const unsaved = step.unsaved === undefined ? {} : { transient_observation: { phase: step.unsaved.observation.phase,
      reason: step.unsaved.observation.reason, observed_at: step.unsaved.observation.observedAt, scan_cursor: step.unsaved.cursor } };
    return step.warning === undefined ? result : { ...result, transient_warning: step.warning, ...unsaved };
  }
  private dependencies(): MetaMaskGaslessDependencies {
    if (this.context.metaMaskGasless === undefined) mmFail("mm_gasless_capability_unavailable");
    return this.context.metaMaskGasless;
  }
  private execution(): MetaMaskGaslessExecution {
    const d = this.dependencies();
    return new MetaMaskGaslessExecution(this.context.state, d.rpcFor, d.provider, this.context.clock, async (op, patch, at) => {
      const next = advanceMetaMaskGaslessOperation(op, patch, at);
      await this.records.persist(next);
      return next;
    }, this.context.wait);
  }
  private async locked<T>(input: string, work: (op: MetaMaskGaslessOperationRecord) => Promise<T>): Promise<T> {
    const id = canonicalOperationId(input), first = await this.operations.required(id);
    if (first.kind !== "metamask_gasless_transfer") mmFail("mm_gasless_input");
    return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${id}`], async () => {
      const current = await this.operations.required(id);
      if (current.kind !== "metamask_gasless_transfer") mmFail("mm_gasless_state_corrupt");
      await this.records.repairReceipt(current.record);
      return await work(current.record);
    });
  }
}
