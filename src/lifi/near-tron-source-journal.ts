/** Pure, untrusted projection of a read-only NEAR/1Click preparation into a journal binding.
 * The protocol input hash is returned separately: journal v1 does not persist or validate it.
 * This module never stages a journal or grants execution authority.
 */
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord, sha256 } from "../canonical.js";
import { validateNonEvmBridgeOperation } from "./non-evm-operation.js";
import type { NonEvmSourceBinding } from "./non-evm-source-journal.js";
import { inspectNearBaseTronQuoteOffline } from "./near-tron-offline.js";
import type { NearTronSourcePreparation } from "./near-tron-source-preparation.js";
import { addressSchema, hashSchema, hexSchema, isoSchema, uintSchema, wordSchema } from "./schema.js";
import { BRIDGE_DIAMOND, bridgeFailure, bridgeRecord, bridgeUint } from "./validation.js";

const ROUTE = "base_usdc_to_tron_usdt_lifi_near_intents" as const;
function fail(reason: string): never { return bridgeFailure("APN_OPERATION_BLOCKED", `near_tron_journal_${reason}`); }

export interface NearTronSourceJournalInput {
  readonly preparation: NearTronSourcePreparation;
  readonly draft: unknown;
  readonly quote: unknown;
  readonly profileHash: string;
  readonly operationId: string;
  readonly createdAt: string;
  /** Synthetic claims are recorded as untrusted. The signer and facet must be independently established. */
  readonly syntheticAdmission: Readonly<{ backendSigner: string; facetAddress: string; facetCodeHash: string;
    claimedValidationHash: string; note: string }>;
}
export interface NearTronSourceJournalProjection {
  readonly executionAdmitted: false;
  readonly evidenceTrust: "untrusted_quote_and_rpc";
  /** Not stored in journal v1; a future versioned journal must bind this before execution. */
  readonly protocolInputHash: string;
  readonly binding: NonEvmSourceBinding;
}

export function bindNearTronSourcePreparationToJournal(input: NearTronSourceJournalInput): NearTronSourceJournalProjection {
  const draft = validateNonEvmBridgeOperation(input.draft);
  if (draft.route !== ROUTE || draft.profileHash !== input.profileHash || draft.operationId !== input.operationId ||
    !hashSchema.safeParse(input.profileHash).success || !hashSchema.safeParse(input.operationId).success ||
    !isoSchema.safeParse(input.createdAt).success) fail("draft_identity");
  const p = input.preparation;
  if (!isPlainRecord(p) || !exactKeys(p, ["kind", "executionAdmitted", "evidenceTrust",
    "draftIntegrityHash", "quoteHash", "quoteId", "preflightBlockHash", "sourceCall",
    "maxSourceNativeDebitWei", "preparationDigest"])) fail("preparation_shape");
  if (p.kind !== "read_only_near_tron_source_preparation" || p.executionAdmitted !== false ||
    p.evidenceTrust !== "untrusted_quote_and_rpc") fail("preparation_kind");
  const { preparationDigest: _digest, ...preparedBody } = p;
  if (!hashSchema.safeParse(p.preparationDigest).success || hashObject(preparedBody) !== p.preparationDigest ||
    p.draftIntegrityHash !== draft.integrityHash || p.quoteHash !== draft.provider.quoteHash ||
    sha256(canonicalJson(input.quote)) !== p.quoteHash ||
    !wordSchema.safeParse(p.quoteId).success || !wordSchema.safeParse(p.preflightBlockHash).success) fail("preparation_digest_or_quote");
  const inspection = inspectNearBaseTronQuoteOffline(input.quote, {
    sender: getAddress(draft.source.owner), tronRecipient: draft.destination.recipient,
    sourceAmountAtomic: draft.source.amountAtomic, maxFeeAtomic: draft.maxProviderFeeAtomic,
    minOutputAtomic: draft.destination.minimumReceivedAtomic,
  });
  const q = bridgeRecord(input.quote), tx = bridgeRecord(q.transactionRequest), c = p.sourceCall;
  if (!isPlainRecord(c) || !exactKeys(c, ["chainId", "from", "to", "valueAtomic", "data",
    "dataSha256", "type", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic",
    "maxPriorityFeePerGasAtomic", "accessList"])) fail("source_call_shape");
  if (!addressSchema.safeParse(c.from).success || !addressSchema.safeParse(c.to).success ||
    !hexSchema.safeParse(c.data).success || !hashSchema.safeParse(c.dataSha256).success ||
    !uintSchema.safeParse(c.valueAtomic).success || !uintSchema.safeParse(c.nonceAtomic).success ||
    !uintSchema.safeParse(c.gasLimitAtomic).success || !uintSchema.safeParse(c.maxFeePerGasAtomic).success ||
    !uintSchema.safeParse(c.maxPriorityFeePerGasAtomic).success) fail("source_call_shape");
  if (p.quoteId !== inspection.quoteId || p.quoteId !== draft.provider.quoteId ||
    draft.provider.depositAddress !== inspection.depositAddress ||
    draft.provider.transactionId !== q.transactionId || draft.provider.routeId !== q.id ||
    draft.provider.stepId !== bridgeRecord((q.includedSteps as unknown[])[1]).id ||
    c.chainId !== 8453 || c.type !== "eip1559" || c.from !== draft.source.owner ||
    c.to !== BRIDGE_DIAMOND || c.to !== draft.sourceCall.to || c.to !== inspection.transactionTarget ||
    c.valueAtomic !== "0" || c.valueAtomic !== draft.sourceCall.valueAtomic ||
    c.data !== draft.sourceCall.data || c.data !== tx.data ||
    c.dataSha256 !== inspection.calldataSha256 || c.dataSha256 !== draft.sourceCall.dataSha256 ||
    c.dataSha256 !== sha256(Buffer.from(c.data.slice(2), "hex")) ||
    c.gasLimitAtomic !== BigInt(tx.gasLimit as string).toString() ||
    !Array.isArray(c.accessList) || c.accessList.length !== 0) fail("source_call");
  const gas = bridgeUint(c.gasLimitAtomic, true);
  const maxFee = bridgeUint(c.maxFeePerGasAtomic, true), tip = bridgeUint(c.maxPriorityFeePerGasAtomic, true);
  const value = bridgeUint(c.valueAtomic), cap = bridgeUint(p.maxSourceNativeDebitWei, true);
  if (tip > maxFee || gas * maxFee + value > cap ||
    p.maxSourceNativeDebitWei !== draft.maxSourceNativeDebitWei) fail("envelope_or_cap");
  const admission = input.syntheticAdmission;
  if (!addressSchema.safeParse(admission.backendSigner).success ||
    !addressSchema.safeParse(admission.facetAddress).success ||
    !hashSchema.safeParse(admission.facetCodeHash).success ||
    !hashSchema.safeParse(admission.claimedValidationHash).success ||
    admission.facetAddress === "0x0000000000000000000000000000000000000000" ||
    typeof admission.note !== "string" || admission.note.length < 1 || admission.note.length > 256) fail("synthetic_admission");
  const backendSigner = getAddress(admission.backendSigner);
  const facetAddress = getAddress(admission.facetAddress);
  const protocolInputHash = hashObject({ policy: "apn.near-tron-source-journal-input.v1",
    profileHash: input.profileHash, operationId: input.operationId, createdAt: input.createdAt,
    draftIntegrityHash: draft.integrityHash, preparationDigest: p.preparationDigest,
    quoteHash: p.quoteHash, quoteId: inspection.quoteId, transactionId: draft.provider.transactionId,
    depositAddress: inspection.depositAddress, refundRecipient: draft.source.owner,
    tronRecipient: draft.destination.recipient, facetNonEvmReceiver: inspection.facetNonEvmReceiver,
    sourceAmountAtomic: draft.source.amountAtomic, bridgeAmountAtomic: inspection.bridgeAmountAtomic,
    minimumOutputAtomic: inspection.facetMinimumOutputAtomic, deadline: inspection.deadline,
    diamond: BRIDGE_DIAMOND, facetAddress, facetCodeHash: admission.facetCodeHash, backendSigner,
    preflightBlockHash: p.preflightBlockHash, sourceCall: c, maxSourceNativeDebitWei: cap.toString() });
  const binding: NonEvmSourceBinding = Object.freeze({ profileHash: input.profileHash, operationId: input.operationId,
    draftIntegrityHash: draft.integrityHash, route: ROUTE, createdAt: input.createdAt,
    sourceCall: Object.freeze({ ...c, accessList: Object.freeze([]) as [] }),
    maxSourceNativeDebitWei: cap.toString(), admissionProof: Object.freeze({ kind: "synthetic_untrusted",
      claimedValidationHash: admission.claimedValidationHash, note: admission.note }) });
  return Object.freeze({ executionAdmitted: false, evidenceTrust: "untrusted_quote_and_rpc",
    protocolInputHash, binding });
}
