import { ApnError } from "../errors.js";
import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { GaslessExecution } from "./execution.js";
import type { GaslessChainId } from "./model.js";
import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import { GaslessOperationRepository } from "./operation-repository.js";
import { gaslessOwner } from "./owner.js";
import type { GaslessApprovalPort, GaslessCustodyPort, GaslessObservationRpcFactory, GaslessRpcFactory } from "./ports.js";
import { GaslessObservationService } from "./observation.js";
import { gaslessObservationRpcEnv } from "./observation-source.js";
import { GaslessPreparation } from "./prepare.js";
import { publicGaslessOperation } from "./receipt.js";
import { gaslessDeployment } from "./registry.js";
import { snapshotSchema } from "./schema.js";
import { transitionGasless } from "./transitions.js";
import { gaslessFailure } from "./validation.js";

export interface GaslessDependencies {
  readonly rpcFor: GaslessRpcFactory;
  readonly observationRpcFor?: GaslessObservationRpcFactory;
  readonly custody: GaslessCustodyPort;
  readonly approval?: GaslessApprovalPort;
}
export class GaslessService {
  readonly records: GaslessOperationRepository;
  readonly operations: OperationService;
  constructor(private readonly context: RuntimeContext) {
    this.records = new GaslessOperationRepository(context.state.root);
    this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, this.records);
  }
  async balance(profile: string, chainId: GaslessChainId) {
    const row = gaslessDeployment(chainId), { owner } = await gaslessOwner(this.context.state, profile);
    const rpc = this.dependencies().rpcFor(chainId);
    const snapshot = await rpc.snapshot(owner.address);
    if (!snapshotSchema.safeParse(snapshot).success || snapshot.chainId !== chainId || snapshot.owner !== owner.address ||
      snapshot.token !== row.token) gaslessFailure("APN_RPC_PROTOCOL", "gasless_balance_binding");
    return { profile: owner.profile, provider: "local", chain_id: chainId, token: row.token, symbol: "USDC", decimals: 6,
      address: owner.address, balance_atomic: snapshot.balanceAtomic, native_balance_wei: snapshot.nativeBalanceWei,
      paymaster_allowance_atomic: snapshot.allowanceAtomic, delegation: snapshot.delegation,
      block: snapshot.block, rpc_origin: snapshot.rpcOrigin, proof_class: "chain_verified_public_read" };
  }
  async prepare(input: Parameters<GaslessPreparation["prepare"]>[0]) {
    const d = this.dependencies();
    const preparation = new GaslessPreparation({ state: this.context.state, records: this.records,
      operations: this.operations, rpcFor: d.rpcFor, now: () => this.context.clock.now().getTime() });
    return publicGaslessOperation(await preparation.prepare(input));
  }
  async approve(operationId: string) {
    return await this.locked(operationId, async (op) => {
      if (op.terminal || op.state !== "awaiting_approval") return publicGaslessOperation(op);
      const approval = this.dependencies().approval;
      if (approval === undefined) throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this USDC fee transfer in a foreground terminal.", {
        nextActions: [`apn gasless transfer approve --operation ${op.operationId}`],
      });
      return publicGaslessOperation(await this.execution(op).approve(op, approval));
    });
  }
  async resume(operationId: string, observationRpcEnv?: string) {
    if (observationRpcEnv !== undefined) {
      const environmentName = gaslessObservationRpcEnv(observationRpcEnv);
      return await this.locked(operationId, async (op) => {
        if (op.terminal || op.bootstrap.signingAttempts === 0) return publicGaslessOperation(op);
        const factory = this.dependencies().observationRpcFor;
        if (factory === undefined) gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_unavailable");
        const observer = new GaslessObservationService(factory(op.intent.request.chainId, environmentName),
          async (previous, patch) => await this.save(previous, patch), environmentName);
        return publicGaslessOperation(await observer.run(op));
      });
    }
    return await this.locked(operationId, async (op) => publicGaslessOperation(
      op.terminal || op.state === "awaiting_approval" ? op : await this.execution(op).run(op)));
  }
  async status(operationId: string) { return await this.locked(operationId, async (op) => publicGaslessOperation(op)); }
  async receipt(operationId: string) {
    return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
  }
  private dependencies(): GaslessDependencies {
    if (this.context.gasless === undefined) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_runtime_unavailable");
    return this.context.gasless;
  }
  private execution(op: GaslessOperationRecord) {
    const d = this.dependencies();
    return new GaslessExecution(this.context.state, d.rpcFor(op.intent.request.chainId), d.custody,
      () => this.context.clock.now().getTime(), async (previous, patch) => await this.save(previous, patch), this.context.wait);
  }
  private async save(op: GaslessOperationRecord, patch: Partial<GaslessMutable>) {
    const next = transitionGasless(op, patch, this.context.clock.now().toISOString());
    await this.records.persist(next); return next;
  }
  private async locked<T>(input: string, work: (op: GaslessOperationRecord) => Promise<T>): Promise<T> {
    const operationId = canonicalOperationId(input), first = await this.operations.required(operationId);
    if (first.kind !== "gasless_transfer") gaslessFailure("APN_OPERATION_BLOCKED", "gasless_operation_kind");
    return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${operationId}`], async () => {
      const current = await this.operations.required(operationId);
      if (current.kind !== "gasless_transfer") gaslessFailure("APN_STATE_CORRUPT", "gasless_operation_kind_changed");
      await this.records.repairReceipt(current.record);
      return await work(current.record);
    });
  }
}
