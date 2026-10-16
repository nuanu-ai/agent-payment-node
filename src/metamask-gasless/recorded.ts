import type { Address } from "../model.js";
import type { MetaMaskGaslessIntent, MetaMaskGaslessProtocolName } from "./model.js";
import { mmFail } from "./reasons.js";
import { mmCanonicalAddress } from "./validation.js";

/** The deployment values a quote or an unsigned delegation is checked against. */
export interface MmDeploymentView {
  readonly token: Address;
  readonly protocol: Readonly<Partial<Record<MetaMaskGaslessProtocolName, { readonly address: Address }>>>;
}

/**
 * The deployment exactly as this saved record froze it at prepare. Saved records are validated against their own
 * values, never against today's registry: a registry change refuses new prepares, never the operations already saved.
 */
export function mmRecordedDeployment(intent: MetaMaskGaslessIntent): MmDeploymentView {
  const caveats = (intent.unsignedDelegation as { readonly caveats?: unknown } | null)?.caveats;
  if (!Array.isArray(caveats) || caveats.length !== 2) mmFail("mm_gasless_state_corrupt");
  const enforcer = (index: 0 | 1): Address => mmCanonicalAddress((caveats[index] as { readonly enforcer?: unknown } | null)?.enforcer);
  return { token: mmCanonicalAddress(intent.token), protocol: {
    manager: { address: mmCanonicalAddress(intent.relayTo) }, limitedCalls: { address: enforcer(0) },
    ...(intent.quote.feeMode === "sponsored" ? {} : { exactBatch: { address: enforcer(1) } }),
  } };
}
