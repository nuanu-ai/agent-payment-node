import { hashObject } from "../canonical.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import { gaslessFee, gaslessGas } from "./economics.js";
import { gaslessOwner } from "./owner.js";
import { gaslessDeployment } from "./registry.js";
import { newGaslessOperation } from "./transitions.js";
import { GASLESS_TTL_MS, GASLESS_ZERO_ADDRESS, assertGaslessExecutionChain, gaslessFailure, validateGaslessRequest } from "./validation.js";
import { gaslessBatch, gaslessEnvelopeBinding } from "./wire.js";
export class GaslessPreparation {
    o;
    constructor(o) {
        this.o = o;
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile), request = validateGaslessRequest(input.request);
        const key = canonicalIdempotencyKey(input.idempotencyKey), state = this.o.state;
        const profileHash = state.profileHash(profile), operationId = state.operationId(profile, key);
        const idempotencyHash = state.idempotencyHash(key), requestHash = hashObject({ profile, request });
        return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
            const existing = await this.o.operations.resolvePrepare({ kind: "gasless_transfer", profileHash,
                operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "gasless_transfer")
                    gaslessFailure("APN_STATE_CORRUPT", "gasless_operation_kind");
                await this.o.records.repairReceipt(existing.record);
                return existing.record;
            }
            assertGaslessExecutionChain(request.chainId);
            await this.o.operations.assertProfileAvailable(profileHash);
            const binding = await gaslessOwner(state, profile), row = gaslessDeployment(request.chainId);
            if ([GASLESS_ZERO_ADDRESS, binding.owner.address, row.token, row.paymaster, row.entryPoint, row.delegate].includes(request.recipient)) {
                gaslessFailure("APN_INVALID_INPUT", "gasless_recipient_alias");
            }
            const rpc = this.o.rpcFor(request.chainId);
            const initialSnapshot = await rpc.snapshot(binding.owner.address), gas = gaslessGas(initialSnapshot);
            const feeCapAtomic = gaslessFee(gas, initialSnapshot.feeConfiguration);
            const net = BigInt(request.grossAtomic) - BigInt(feeCapAtomic);
            if (BigInt(feeCapAtomic) > BigInt(request.maxFeeAtomic) || net < BigInt(request.minReceivedAtomic) || net <= 0n) {
                gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_fee_budget");
            }
            const preparedAt = new Date(this.o.now()).toISOString(), recipientAtomic = net.toString();
            const unsigned = { wireVersion: "apn.gasless-wire.v2", profile, request, ...binding,
                initialSnapshot, gas, token: row.token, tokenDomain: row.tokenDomain, paymaster: row.paymaster,
                entryPoint: row.entryPoint, delegate: row.delegate, feeCapAtomic, recipientAtomic,
                callData: gaslessBatch(row.token, request.recipient, recipientAtomic, row.paymaster), preparedAt,
                expiresAt: new Date(Date.parse(preparedAt) + GASLESS_TTL_MS).toISOString(),
                policyHash: hashObject({ identity: "apn.gasless.foreground-approval.v1", request }) };
            const intent = { ...unsigned, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(unsigned)) };
            const operation = newGaslessOperation({ profileHash, operationId, idempotencyHash, requestHash, intent });
            await this.o.records.persist(operation);
            return operation;
        });
    }
}
//# sourceMappingURL=prepare.js.map