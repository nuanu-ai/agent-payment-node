import { hashObject } from "../canonical.js";
import { gaslessOwner } from "../gasless/owner.js";
import { GASLESS_TTL_MS, GASLESS_ZERO_ADDRESS, validateGaslessRequest } from "../gasless/validation.js";
import type { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import type { FacilitatorPort } from "./facilitator.js";
import { facilitatorFail } from "./failure.js";
import { FACILITATOR_KIND, FACILITATOR_POLICY, type FacilitatorOperationRecord, type FacilitatorRequest } from "./operation-model.js";
import type { FacilitatorGaslessRepositoryPort } from "./operation-repository.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
import { facilitatorRequirement, facilitatorRequirementHash } from "./requirement.js";
import type { FacilitatorRpcPort } from "./rpc.js";
import { newFacilitatorOperation } from "./transitions.js";

export interface FacilitatorPreparationOptions {
  readonly state: StateStore;
  readonly records: FacilitatorGaslessRepositoryPort;
  readonly operations: OperationService;
  readonly rpc: () => FacilitatorRpcPort;
  readonly facilitator: FacilitatorPort;
  readonly now: () => number;
}

export function facilitatorRequest(value: unknown): FacilitatorRequest {
  const request = validateGaslessRequest(value);
  if (request.chainId !== R.chainId) facilitatorFail("facilitator_gasless_input");
  return request as FacilitatorRequest;
}

/** Freezes one exact Avalanche USDC transfer; nothing is signed and no payment material leaves APN here. */
export class FacilitatorPreparation {
  constructor(private readonly o: FacilitatorPreparationOptions) {}

  async prepare(input: { readonly profile: string; readonly request: unknown; readonly idempotencyKey: string }):
    Promise<FacilitatorOperationRecord> {
    const profile = canonicalProfile(input.profile), request = facilitatorRequest(input.request);
    const key = canonicalIdempotencyKey(input.idempotencyKey), state = this.o.state;
    const profileHash = state.profileHash(profile), operationId = state.operationId(profile, key);
    const idempotencyHash = state.idempotencyHash(key), requestHash = hashObject({ kind: FACILITATOR_KIND, profile, request });
    return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
      const existing = await this.o.operations.resolvePrepare({ kind: FACILITATOR_KIND, profileHash, operationId, idempotencyHash, requestHash });
      if (existing !== null) {
        if (existing.kind !== FACILITATOR_KIND) return facilitatorFail("facilitator_gasless_state_corrupt");
        await this.o.records.repairReceipt(existing.record);
        return existing.record;
      }
      const binding = await gaslessOwner(state, profile), owner = binding.owner.address;
      await this.o.operations.assertEvmAccountAvailable(profileHash, R.chainId, owner);
      if ([GASLESS_ZERO_ADDRESS, owner, R.token].some((alias) => alias.toLowerCase() === request.recipient.toLowerCase())) {
        facilitatorFail("facilitator_gasless_input");
      }
      const requirement = facilitatorRequirement(request.recipient.toLowerCase(), request.grossAtomic);
      const rpc = this.o.rpc();
      await rpc.assertChain();
      const block = await rpc.finalized(), balance = await rpc.usdcBalance(owner, block);
      if (balance < BigInt(request.grossAtomic)) facilitatorFail("facilitator_gasless_balance");
      const support = await this.o.facilitator.supported();
      const preparedAt = new Date(this.o.now()).toISOString();
      const operation = newFacilitatorOperation({ profileHash, operationId, idempotencyHash, requestHash, intent: {
        profile, request, ...binding, requirement, requirementHash: facilitatorRequirementHash(requirement),
        facilitator: { origin: support.endpointOrigin, endpointHash: support.endpointHash, signers: support.signers,
          supportedResponseHash: support.supportedResponseHash },
        initial: { block, balanceAtomic: balance.toString(), rpcOrigin: rpc.rpcOrigin, rpcEndpointHash: rpc.rpcEndpointHash },
        preparedAt, expiresAt: new Date(Date.parse(preparedAt) + GASLESS_TTL_MS).toISOString(),
        policyHash: hashObject({ identity: FACILITATOR_POLICY, request }) } });
      await this.o.records.persist(operation);
      return operation;
    });
  }
}
