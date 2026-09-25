import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { gaslessPolicyChain, localGaslessMechanism } from "./asset-policy.js";
import { assertGaslessSnapshot, gaslessFee, gaslessFeeCapCovers, validateGaslessStoredOffer } from "./economics.js";
import { gaslessDeployment, gaslessIntentAsset, gaslessProtocolHash } from "./registry.js";
import type { GaslessIntent } from "./model.js";
import { intentSchema } from "./schema.js";
import { GASLESS_TTL_MS, GASLESS_ZERO_ADDRESS, gaslessFailure, gaslessUint, validateGaslessRequest } from "./validation.js";
import { gaslessEnvelopeBinding, validateGaslessBatch } from "./wire.js";

export function validateGaslessIntent(value: unknown): GaslessIntent {
  if (!intentSchema.safeParse(value).success) gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_shape");
  const i = value as GaslessIntent, r = validateGaslessRequest(i.request, "APN_STATE_CORRUPT"), s = i.initialSnapshot;
  const row = gaslessDeployment(r.chainId);
  // The stored asset is resolved back to its registry row: token, permit domain and sponsoring paymaster must match it.
  try { gaslessIntentAsset(i); } catch { gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_binding"); }
  if (i.profile !== i.owner.profile || i.owner.profileHash !== sha256(`profile\0${i.profile}`) ||
    i.providerBinding.accountBindingHash !== i.owner.walletBindingHash || s.owner !== i.owner.address ||
    s.chainId !== r.chainId || s.token !== i.token ||
    i.entryPoint !== row.entryPoint || i.delegate !== row.delegate ||
    s.protocolHash !== gaslessProtocolHash(row) || i.expiresAt <= i.preparedAt ||
    Date.parse(i.expiresAt) - Date.parse(i.preparedAt) !== GASLESS_TTL_MS ||
    i.policyHash !== hashObject({ identity: "apn.gasless.foreground-approval.v1", request: r }) ||
    i.unsignedEnvelopeHash !== hashObject(gaslessEnvelopeBinding(i))) gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_binding");
  if (i.allowlist !== undefined && (gaslessPolicyChain(r.chainId) === null || i.allowlist.chain !== gaslessPolicyChain(r.chainId) ||
    i.allowlist.token !== row.token || i.allowlist.policyRevision < 1 ||
    canonicalJson(i.allowlist.mechanism) !== canonicalJson(localGaslessMechanism(r.chainId)))) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_allowlist_binding");
  }
  if ([GASLESS_ZERO_ADDRESS, i.owner.address, i.token, i.paymaster, i.entryPoint, i.delegate].includes(r.recipient)) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_recipient_alias");
  }
  validateGaslessStoredOffer(i.gas, s, i.wireVersion);
  if (!gaslessFeeCapCovers(i, gaslessFee(i.gas, s.feeConfiguration)) ||
    gaslessUint(i.feeCapAtomic, true) + gaslessUint(i.recipientAtomic, true) !== gaslessUint(r.grossAtomic) ||
    gaslessUint(i.feeCapAtomic) > gaslessUint(r.maxFeeAtomic) || gaslessUint(i.recipientAtomic) < gaslessUint(r.minReceivedAtomic)) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_economics");
  }
  validateGaslessBatch(i); assertGaslessSnapshot(i, s);
  return i;
}
