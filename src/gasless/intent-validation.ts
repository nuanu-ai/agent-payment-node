import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { gaslessPolicyChain, localGaslessMechanism } from "./asset-policy.js";
import { assertGaslessSnapshot, gaslessFee, gaslessFeeCapCovers, validateGaslessStoredOffer } from "./economics.js";
import { gaslessDeployment, gaslessIntentAsset, gaslessProtocolHash } from "./registry.js";
import type { GaslessIntent } from "./model.js";
import { intentSchema } from "./schema.js";
import { GASLESS_TTL_MS, GASLESS_ZERO_ADDRESS, gaslessFailure, gaslessUint, validateGaslessRequest } from "./validation.js";
import { gaslessEnvelopeBinding, validateGaslessBatch } from "./wire.js";

/**
 * Load-time validation of a saved intent (rule R2): only the record's own fields and hashes and the schema it was
 * written with. Registry pins, asset rows and offer constants can change in a later release; they are compared at
 * action time by `assertGaslessIntentCurrent`, so such a change can refuse a new effect but never break status,
 * resume or abandon of a saved operation, nor another family that lists every operation.
 */
export function validateGaslessIntent(value: unknown): GaslessIntent {
  if (!intentSchema.safeParse(value).success) gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_shape");
  const i = value as GaslessIntent, r = validateGaslessRequest(i.request, "APN_STATE_CORRUPT"), s = i.initialSnapshot;
  if (i.profile !== i.owner.profile || i.owner.profileHash !== sha256(`profile\0${i.profile}`) ||
    i.providerBinding.accountBindingHash !== i.owner.walletBindingHash || s.owner !== i.owner.address ||
    s.chainId !== r.chainId || s.token !== i.token ||
    i.tokenDomain.chainId !== r.chainId || i.tokenDomain.verifyingContract !== i.token ||
    i.expiresAt <= i.preparedAt || Date.parse(i.expiresAt) - Date.parse(i.preparedAt) !== GASLESS_TTL_MS ||
    i.policyHash !== hashObject({ identity: "apn.gasless.foreground-approval.v1", request: r }) ||
    i.unsignedEnvelopeHash !== hashObject(gaslessEnvelopeBinding(i))) gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_binding");
  const chain = gaslessPolicyChain(r.chainId);
  if (i.allowlist !== undefined && (chain === null || i.allowlist.chain !== chain || i.allowlist.token !== i.token ||
    i.allowlist.policyRevision < 1 ||
    canonicalJson(i.allowlist.mechanism) !== canonicalJson({ provider: "local", reference: `${chain}:${i.paymaster}` }))) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_allowlist_binding");
  }
  if ([GASLESS_ZERO_ADDRESS, i.owner.address, i.token, i.paymaster, i.entryPoint, i.delegate].includes(r.recipient)) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_recipient_alias");
  }
  if (gaslessUint(i.feeCapAtomic, true) + gaslessUint(i.recipientAtomic, true) !== gaslessUint(r.grossAtomic) ||
    gaslessUint(i.feeCapAtomic) > gaslessUint(r.maxFeeAtomic) || gaslessUint(i.recipientAtomic) < gaslessUint(r.minReceivedAtomic)) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_intent_economics");
  }
  validateGaslessBatch(i);
  return i;
}

/**
 * Before any new effect the saved intent must still be what this release admits. A changed protocol pin, asset row or
 * policy mechanism refuses with `gasless_protocol_upgraded`, a changed offer rule with `gasless_offer_outdated`; both
 * mean: prepare a new transfer. Only saved facts are checked here, so neither can clear by waiting.
 */
export function assertGaslessIntentCurrent(i: GaslessIntent): void {
  const row = gaslessDeployment(i.request.chainId);
  if (i.entryPoint !== row.entryPoint || i.delegate !== row.delegate || i.initialSnapshot.protocolHash !== gaslessProtocolHash(row)) {
    gaslessFailure("APN_OPERATION_BLOCKED", "gasless_protocol_upgraded");
  }
  try { gaslessIntentAsset(i); } catch { gaslessFailure("APN_OPERATION_BLOCKED", "gasless_protocol_upgraded"); }
  if (i.allowlist !== undefined && canonicalJson(i.allowlist.mechanism) !== canonicalJson(localGaslessMechanism(i.request.chainId))) {
    gaslessFailure("APN_OPERATION_BLOCKED", "gasless_protocol_upgraded");
  }
  try {
    validateGaslessStoredOffer(i.gas, i.initialSnapshot, i.wireVersion);
    if (!gaslessFeeCapCovers(i, gaslessFee(i.gas, i.initialSnapshot.feeConfiguration))) throw new Error("fee cap");
    assertGaslessSnapshot(i, i.initialSnapshot);
  } catch { gaslessFailure("APN_OPERATION_BLOCKED", "gasless_offer_outdated"); }
}
