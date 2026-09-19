import type { Address } from "../model.js";
import type { Permit2Requirement } from "./offer.js";
import { selectPermit2Offer, type Permit2OfferSelection } from "./offer.js";

/** Input for the pure Permit2 offer inspection boundary. No RPC, wallet or state port is accepted. */
export interface Permit2OfferInspectionInput {
  readonly accepts: readonly unknown[];
  readonly payer: Address;
}

/**
 * The seller requirement and the list-pinned economics selected for a read-only inspection.
 * `requirement` is the exact seller object, cloned and frozen so callers cannot rewrite the offer.
 */
export interface Permit2OfferInspection {
  readonly index: number;
  readonly requirement: Permit2Requirement;
  readonly network: string;
  readonly asset: Address;
  readonly amountAtomic: string;
  readonly payTo: Address;
  readonly maxTimeoutSeconds: number;
  readonly offerHash: string;
}

/**
 * Inspect the first listed exact Permit2 offer without reading state or preparing authorization.
 * Unsupported offers and invalid payer input retain the canonical ApnError emitted by the selector.
 */
export function inspectPermit2Offer(input: Permit2OfferInspectionInput): Permit2OfferInspection {
  const selection = selectPermit2Offer(input.accepts, input.payer);
  return Object.freeze({
    index: selection.index,
    requirement: freezeRequirement(selection.requirement),
    network: selection.listAsset.chain,
    asset: selection.listAsset.token,
    amountAtomic: selection.amountAtomic,
    payTo: selection.payTo,
    maxTimeoutSeconds: selection.maxTimeoutSeconds,
    offerHash: selection.offerHash,
  });
}

function freezeRequirement(value: Permit2OfferSelection["requirement"]): Permit2Requirement {
  return Object.freeze({ ...value, extra: Object.freeze({ ...value.extra }) });
}
