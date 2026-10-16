import type { Address } from "../model.js";
import type { MetaMaskGaslessDeployment, MetaMaskGaslessIntent, MetaMaskGaslessProtocolName } from "./model.js";
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

/**
 * The deployment an observation proves against: the token, manager and enforcer addresses this record froze, with the
 * code pins its own prepare snapshot read. A pin change in a later release refuses new prepares only; an operation sent
 * before it is still proven against what it was sent with. Chain facts (finality tag) and the 7702 delegate address,
 * which a record without a designation at prepare does not hold, come from the registry row of the chain.
 */
export function mmObservedDeployment(intent: MetaMaskGaslessIntent, chain: MetaMaskGaslessDeployment): MetaMaskGaslessDeployment {
  const recorded = mmRecordedDeployment(intent), pins = intent.initialSnapshot.safeState;
  const code = pins.protocolCodeHashes as Readonly<Record<string, `0x${string}`>>;
  const pin = (name: MetaMaskGaslessProtocolName, address: Address) =>
    ({ address, codeHash: code[name] ?? mmFail("mm_gasless_state_corrupt") });
  return { deploymentEvidenceHash: intent.deploymentEvidenceHash, row: { ...chain.row, token: recorded.token,
    tokenProxyCodeHash: pins.tokenProxyCodeHash, tokenImplementationAddress: pins.tokenImplementationAddress,
    tokenImplementationCodeHash: pins.tokenImplementationCodeHash,
    protocol: { manager: pin("manager", recorded.protocol.manager!.address),
      delegate: pin("delegate", chain.row.protocol.delegate.address),
      limitedCalls: pin("limitedCalls", recorded.protocol.limitedCalls!.address),
      exactBatch: recorded.protocol.exactBatch === undefined ? chain.row.protocol.exactBatch
        : pin("exactBatch", recorded.protocol.exactBatch.address) } } };
}
