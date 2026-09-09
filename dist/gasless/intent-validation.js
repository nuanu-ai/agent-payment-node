import { hashObject, sha256 } from "../canonical.js";
import { assertGaslessSnapshot, gaslessFee, gaslessGas, validateGaslessGas } from "./economics.js";
import { gaslessDeployment, gaslessProtocolHash } from "./registry.js";
import { intentSchema } from "./schema.js";
import { GASLESS_TTL_MS, GASLESS_ZERO_ADDRESS, gaslessFailure, gaslessSame, gaslessUint, validateGaslessRequest } from "./validation.js";
import { gaslessEnvelopeBinding, validateGaslessBatch } from "./wire.js";
export function validateGaslessIntent(value) {
    if (!intentSchema.safeParse(value).success)
        gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_shape");
    const i = value, r = validateGaslessRequest(i.request, "APN_STATE_CORRUPT"), s = i.initialSnapshot;
    const row = gaslessDeployment(r.chainId);
    if (i.profile !== i.owner.profile || i.owner.profileHash !== sha256(`profile\0${i.profile}`) ||
        i.providerBinding.accountBindingHash !== i.owner.walletBindingHash || s.owner !== i.owner.address ||
        s.chainId !== r.chainId || s.token !== i.token || i.token !== row.token || i.paymaster !== row.paymaster ||
        i.entryPoint !== row.entryPoint || i.delegate !== row.delegate || !gaslessSame(i.tokenDomain, row.tokenDomain) ||
        s.protocolHash !== gaslessProtocolHash(row) || i.expiresAt <= i.preparedAt ||
        Date.parse(i.expiresAt) - Date.parse(i.preparedAt) !== GASLESS_TTL_MS ||
        i.policyHash !== hashObject({ identity: "apn.gasless.foreground-approval.v1", request: r }) ||
        i.unsignedEnvelopeHash !== hashObject(gaslessEnvelopeBinding(i)))
        gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_binding");
    if ([GASLESS_ZERO_ADDRESS, i.owner.address, i.token, i.paymaster, i.entryPoint, i.delegate].includes(r.recipient)) {
        gaslessFailure("APN_STATE_CORRUPT", "gasless_recipient_alias");
    }
    validateGaslessGas(i.gas);
    if (!gaslessSame(i.gas, gaslessGas(s)) || i.feeCapAtomic !== gaslessFee(i.gas, s.feeConfiguration) ||
        gaslessUint(i.feeCapAtomic, true) + gaslessUint(i.recipientAtomic, true) !== gaslessUint(r.grossAtomic) ||
        gaslessUint(i.feeCapAtomic) > gaslessUint(r.maxFeeAtomic) || gaslessUint(i.recipientAtomic) < gaslessUint(r.minReceivedAtomic)) {
        gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_economics");
    }
    validateGaslessBatch(i);
    assertGaslessSnapshot(i, s);
    return i;
}
//# sourceMappingURL=intent-validation.js.map