import { ApnError } from "../errors.js";
import { gaslessOwner } from "../gasless/owner.js";
import type { GaslessApprovalPort } from "../gasless/ports.js";
import { OperationService } from "../operation-service.js";
import type { RuntimeContext } from "../runtime.js";
import { canonicalOperationId } from "../transfer-policy.js";
import type { FacilitatorSignerPort } from "./custody.js";
import { FacilitatorExecution } from "./execution.js";
import type { FacilitatorPort } from "./facilitator.js";
import { facilitatorFail } from "./failure.js";
import { FACILITATOR_KIND, type FacilitatorOperationRecord } from "./operation-model.js";
import { FacilitatorGaslessOperationRepository, type FacilitatorGaslessRepositoryPort } from "./operation-repository.js";
import { FacilitatorPreparation } from "./prepare.js";
import { publicFacilitatorOperation } from "./receipt.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
import type { FacilitatorRpcPort } from "./rpc.js";
import { transitionFacilitator } from "./transitions.js";

export interface FacilitatorGaslessDependencies {
  readonly rpc: () => FacilitatorRpcPort;
  readonly facilitator: FacilitatorPort;
  readonly signer: FacilitatorSignerPort;
  readonly approval?: GaslessApprovalPort;
  readonly records?: FacilitatorGaslessRepositoryPort;
}

/** Local-wallet Avalanche USDC transfers relayed by a public x402 facilitator: EIP-3009, no EIP-7702 delegation. */
export class FacilitatorGaslessService {
  readonly records: FacilitatorGaslessRepositoryPort;
  readonly operations: OperationService;

  constructor(private readonly context: RuntimeContext) {
    this.records = context.facilitatorGasless?.records ?? new FacilitatorGaslessOperationRepository(context.state.root);
    this.operations = new OperationService(context.state, context.providerX402Repository, undefined, undefined, undefined,
      context.metaMaskGasless?.records, context.smartAccountGasless?.records, this.records);
  }

  async balance(profile: string) {
    const { owner } = await gaslessOwner(this.context.state, profile), rpc = this.dependencies().rpc();
    await rpc.assertChain();
    const block = await rpc.finalized(), balance = await rpc.usdcBalance(owner.address, block);
    return { profile: owner.profile, provider: "local", route: "x402_exact_eip3009_public_facilitator", chain_id: R.chainId,
      token: R.token, symbol: "USDC", decimals: R.decimals, address: owner.address, balance_atomic: balance.toString(), block,
      rpc_origin: rpc.rpcOrigin, endpoint_hash: rpc.rpcEndpointHash, sender_native_balance_required: false,
      proof_class: "chain_verified_public_read" };
  }

  async prepare(input: { readonly profile: string; readonly request: unknown; readonly idempotencyKey: string }) {
    const d = this.dependencies();
    return publicFacilitatorOperation(await new FacilitatorPreparation({ state: this.context.state, records: this.records,
      operations: this.operations, rpc: d.rpc, facilitator: d.facilitator, now: () => this.context.clock.now().getTime() }).prepare(input));
  }

  async approve(operationId: string) {
    return await this.locked(operationId, async (op) => {
      if (op.terminal || op.state !== "awaiting_approval") return publicFacilitatorOperation(op);
      const approval = this.dependencies().approval;
      if (approval === undefined) {
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Approve this Avalanche USDC transfer in a foreground terminal.",
          { reason: "facilitator_gasless_approval", nextActions: [`apn gasless transfer approve --operation ${op.operationId}`] });
      }
      return publicFacilitatorOperation(await this.execution().approve(op, approval));
    });
  }

  async resume(operationId: string) {
    return await this.locked(operationId, async (op) => publicFacilitatorOperation(await this.execution().run(op)));
  }

  async status(operationId: string) { return await this.locked(operationId, async (op) => publicFacilitatorOperation(op)); }

  async receipt(operationId: string) {
    return await this.locked(operationId, async (op) => await this.records.loadReceipt(op.profileHash, op.operationId));
  }

  private dependencies(): FacilitatorGaslessDependencies {
    if (this.context.facilitatorGasless === undefined) facilitatorFail("facilitator_gasless_capability");
    return this.context.facilitatorGasless;
  }

  private execution(): FacilitatorExecution {
    const d = this.dependencies();
    return new FacilitatorExecution(this.context.state, d.rpc, d.facilitator, d.signer, () => this.context.clock.now().getTime(),
      async (op, patch) => {
        const next = transitionFacilitator(op, patch, this.context.clock.now().toISOString());
        await this.records.persist(next);
        return next;
      });
  }

  private async locked<T>(input: string, work: (op: FacilitatorOperationRecord) => Promise<T>): Promise<T> {
    const id = canonicalOperationId(input), first = await this.operations.required(id);
    if (first.kind !== FACILITATOR_KIND) facilitatorFail("facilitator_gasless_input");
    return await this.context.state.withLocks([`profile:${first.record.profileHash}`, `operation:${id}`], async () => {
      const current = await this.operations.required(id);
      if (current.kind !== FACILITATOR_KIND) facilitatorFail("facilitator_gasless_state_corrupt");
      await this.records.repairReceipt(current.record);
      return await work(current.record);
    });
  }
}
