import { hashObject } from "../canonical.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import type { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { gaslessCalibratedGas, gaslessFee } from "./economics.js";
import { gaslessPolicyChain, type GaslessAssetPolicy } from "./asset-policy.js";
import type { GaslessIntent, GaslessRequest } from "./model.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import type { GaslessOperationRepository } from "./operation-repository.js";
import { gaslessOwner } from "./owner.js";
import type { GaslessRpcFactory } from "./ports.js";
import { gaslessDeployment } from "./registry.js";
import { newGaslessOperation } from "./transitions.js";
import { GASLESS_TTL_MS, GASLESS_ZERO_ADDRESS, assertGaslessExecutionChain, gaslessFailure,
  validateGaslessRequest } from "./validation.js";
import { gaslessBatch, gaslessEnvelopeBinding } from "./wire.js";

export interface GaslessPreparationOptions {
  readonly state: StateStore;
  readonly records: GaslessOperationRepository;
  readonly operations: OperationService;
  readonly rpcFor: GaslessRpcFactory;
  readonly now: () => number;
  readonly policy: GaslessAssetPolicy;
}
export class GaslessPreparation {
  constructor(private readonly o: GaslessPreparationOptions) {}
  async prepare(input: { readonly profile: string; readonly request: GaslessRequest;
    readonly idempotencyKey: string }): Promise<GaslessOperationRecord> {
    const profile = canonicalProfile(input.profile), request = validateGaslessRequest(input.request);
    const key = canonicalIdempotencyKey(input.idempotencyKey), state = this.o.state;
    const profileHash = state.profileHash(profile), operationId = state.operationId(profile, key);
    const idempotencyHash = state.idempotencyHash(key), requestHash = hashObject({ profile, request });
    return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`,
      `operation:idempotency:${idempotencyHash}`], async () => await state.withLocks([
      `profile:${allowlistProfileHash(profile)}`], async () => {
      const existing = await this.o.operations.resolvePrepare({ kind: "gasless_transfer", profileHash,
        operationId, idempotencyHash, requestHash });
      if (existing !== null) {
        if (existing.kind !== "gasless_transfer") gaslessFailure("APN_STATE_CORRUPT", "gasless_operation_kind");
        await this.o.records.repairReceipt(existing.record); return existing.record;
      }
      assertGaslessExecutionChain(request.chainId);
      const binding = await gaslessOwner(state, profile), row = gaslessDeployment(request.chainId);
      const allowlist = gaslessPolicyChain(request.chainId) !== null ? await this.o.policy.prepare({ profile, owner: binding.owner,
        request, token: row.token }, operationId) : undefined;
      await this.o.operations.assertEvmAccountAvailable(profileHash, request.chainId, binding.owner.address);
      if ([GASLESS_ZERO_ADDRESS, binding.owner.address, row.token, row.paymaster, row.entryPoint, row.delegate].includes(request.recipient)) {
        gaslessFailure("APN_INVALID_INPUT", "gasless_recipient_alias");
      }
      const rpc = this.o.rpcFor(request.chainId);
      const initialSnapshot = await rpc.snapshot(binding.owner.address), gas = gaslessCalibratedGas(initialSnapshot);
      // Freeze the owner's whole fee limit so a paymaster price move before signing cannot cancel the approval.
      const quoteAtomic = BigInt(gaslessFee(gas, initialSnapshot.feeConfiguration));
      const gross = BigInt(request.grossAtomic), spendable = gross - BigInt(request.minReceivedAtomic);
      const cap = BigInt(request.maxFeeAtomic) < spendable ? BigInt(request.maxFeeAtomic) : spendable, net = gross - cap;
      if (quoteAtomic > cap || net < BigInt(request.minReceivedAtomic) || net <= 0n) {
        gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_fee_budget");
      }
      const feeCapAtomic = cap.toString();
      const preparedAt = new Date(this.o.now()).toISOString(), recipientAtomic = net.toString();
      const unsigned: Omit<GaslessIntent, "unsignedEnvelopeHash"> = { wireVersion: "apn.gasless-wire.v4", profile, request, ...binding,
        initialSnapshot, gas, token: row.token, tokenDomain: row.tokenDomain, paymaster: row.paymaster,
        entryPoint: row.entryPoint, delegate: row.delegate, feeCapAtomic, recipientAtomic,
        callData: gaslessBatch(row.token, request.recipient, recipientAtomic, row.paymaster), preparedAt,
        expiresAt: new Date(Date.parse(preparedAt) + GASLESS_TTL_MS).toISOString(),
        policyHash: hashObject({ identity: "apn.gasless.foreground-approval.v1", request }),
        ...(allowlist === undefined ? {} : { allowlist }) };
      const intent = { ...unsigned, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(unsigned)) };
      const operation = newGaslessOperation({ profileHash, operationId, idempotencyHash, requestHash, intent });
      await this.o.records.persist(operation); return operation;
    }));
  }
}
