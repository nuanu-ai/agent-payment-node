import type { OperationService } from "../operation-service.js";
import type { ClockPort, IdPort } from "../ports.js";
import type { StateStore } from "../state.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { validateMetaMaskGaslessSnapshot } from "./chain/snapshot.js";
import { MetaMaskGaslessClock } from "./clock.js";
import { mmPolicyHash } from "./economics.js";
import { mmAssertProfileBinding } from "./identity.js";
import { newMetaMaskGaslessOperation } from "./journal/transitions.js";
import { MM_TTL_MS, MM_ZERO_ADDRESS, type MetaMaskGaslessIntent, type MetaMaskGaslessRequest } from "./model.js";
import { mmRequestHash, type MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { metaMaskGaslessOwner } from "./owner.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessRepositoryPort, MetaMaskGaslessRpcFactory } from "./ports.js";
import { metaMaskGaslessQuote } from "./quotation.js";
import { mmRegistry } from "./registry.js";
import { mmFail } from "./reasons.js";
import { mmValidateUnsigned } from "./unsigned.js";
import { mmRequest, mmUuid } from "./validation.js";

export interface MetaMaskGaslessPreparationOptions {
  readonly state: StateStore;
  readonly records: MetaMaskGaslessRepositoryPort;
  readonly operations: OperationService;
  readonly rpcFor: MetaMaskGaslessRpcFactory;
  readonly provider: MetaMaskGaslessProviderPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}
export class MetaMaskGaslessPreparation {
  constructor(private readonly o: MetaMaskGaslessPreparationOptions) {}
  async prepare(input: { readonly profile: string; readonly request: MetaMaskGaslessRequest;
    readonly idempotencyKey: string }): Promise<MetaMaskGaslessOperationRecord> {
    const profile = canonicalProfile(input.profile), request = mmRequest(input.request), state = this.o.state;
    const key = canonicalIdempotencyKey(input.idempotencyKey), profileHash = state.profileHash(profile);
    const operationId = state.operationId(profile, key), idempotencyHash = state.idempotencyHash(key);
    const { row, deploymentEvidenceHash } = mmRegistry(request.chainId);
    const requestHash = mmRequestHash(profileHash, { request, token: row.token });
    return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
      const existing = await this.o.operations.resolvePrepare({ kind: "metamask_gasless_transfer", profileHash,
        operationId, idempotencyHash, requestHash });
      if (existing !== null) {
        if (existing.kind !== "metamask_gasless_transfer") mmFail("mm_gasless_state_corrupt");
        await this.o.records.repairReceipt(existing.record);
        return existing.record;
      }
      const clock = new MetaMaskGaslessClock(this.o.clock); clock.check();
      const owner = await metaMaskGaslessOwner(state, profile); clock.check();
      await this.o.operations.assertEvmAccountAvailable(profileHash, request.chainId, owner.address);
      if ([MM_ZERO_ADDRESS, owner.address, row.token, ...Object.values(row.protocol).map(p => p.address)].includes(request.recipient)) {
        mmFail("mm_gasless_input");
      }
      const rpc = this.o.rpcFor(request.chainId);
      if (rpc.chainId !== request.chainId) mmFail("mm_gasless_rpc_binding");
      return await state.withLocks(["provider-session:metamask-agent-wallet"], async () => {
        clock.check();
        const binding = await this.o.provider.inspect(owner); clock.check();
        mmAssertProfileBinding(binding, owner);
        const quote = await metaMaskGaslessQuote(this.o.provider, binding, request, rpc.rpcUrl, clock); clock.check();
        const unsignedInput = { owner: binding.address, chainId: request.chainId, executions: quote.executions };
        const unsigned = await this.o.provider.buildUnsigned(unsignedInput); clock.check();
        const checkedUnsigned = mmValidateUnsigned(unsigned, unsignedInput);
        const snapshot = await rpc.snapshot({ owner: binding.address, delegationHash: checkedUnsigned.delegationHash,
          grossAtomic: request.grossAtomic }); clock.check(undefined, [snapshot.observedAt]);
        const initialSnapshot = validateMetaMaskGaslessSnapshot(snapshot, { chainId: request.chainId,
          endpointHash: rpc.endpointHash, endpointOrigin: rpc.endpointOrigin, grossAtomic: request.grossAtomic });
        const prepared = clock.fresh(initialSnapshot.observedAt), preparedAt = new Date(prepared).toISOString();
        const intent: MetaMaskGaslessIntent = { profile, request, binding, ...checkedUnsigned, token: row.token, decimals: 6,
          deploymentEvidenceHash, initialSnapshot, quote, requestId: mmUuid(this.o.ids.next()), preparedAt,
          expiresAt: new Date(prepared + MM_TTL_MS).toISOString(), policyHash: mmPolicyHash(profileHash, binding, request) };
        const operation = newMetaMaskGaslessOperation({ profileHash, operationId, idempotencyHash, requestHash }, intent);
        clock.check(operation);
        await this.o.records.persist(operation);
        return operation;
      });
    });
  }
}
