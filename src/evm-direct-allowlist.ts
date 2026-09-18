import { refuse, requireListedDirectAsset, validateDirectAllowlistBinding, validateDirectAllowlistLease, type DirectAllowlistSubject, type DirectUsageTarget } from "./direct-allowlist-gate.js";
import { ApnError } from "./errors.js";
import { EVM_NETWORKS, evmToken, type EvmAssetSelection } from "./evm-asset.js";
import type { OperationRecord, OperationState } from "./model.js";

export interface ListedEvmAsset {
  readonly selection: EvmAssetSelection;
  /** Decimals always come from the frozen list row, never from the caller or the token contract. */
  readonly decimals: number;
}

/**
 * Direct EVM transfers accept only frozen-list networks and pinned list contracts. This runs in the CLI/MCP binder and
 * again at prepare, before any RPC, custody or signing call.
 */
export function listedEvmAsset(chainValue: unknown, tokenValue: unknown, decimals?: number): ListedEvmAsset {
  const chain = typeof chainValue === "number" ? `eip155:${chainValue}` : chainValue;
  if (typeof chain !== "string" || !/^eip155:[1-9][0-9]{0,77}$/u.test(chain)) {
    throw new ApnError("APN_INVALID_INPUT", "Select an EVM network by its exact CAIP-2 identity.");
  }
  const token = evmToken(tokenValue);
  const row = requireListedDirectAsset(chain, token === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: token });
  if (decimals !== undefined && decimals !== row.decimals) {
    refuse("allowlist_decimals_mismatch", "The supplied decimals differ from the frozen allowlist row for this asset.",
      { chain, decimals: String(row.decimals) });
  }
  const network = EVM_NETWORKS.find((entry) => entry.caip2 === chain);
  if (network === undefined) {
    refuse("allowlist_network_not_enabled", "The network is on the frozen allowlist, but APN direct EVM transfers are not enabled on it yet.", { chain });
  }
  return { selection: { chainId: network.chainId, token, ...(decimals === undefined ? {} : { decimals }) }, decimals: row.decimals };
}

export function evmAllowlistSubject(operation: Pick<OperationRecord, "profile" | "operationId" | "walletAddress" | "chainId" | "token" | "amountAtomic" | "evm">): DirectAllowlistSubject {
  const asset = operation.evm?.asset;
  if (asset === undefined) throw new ApnError("APN_STATE_CORRUPT", "Only an explicit EVM asset transfer carries a direct allowlist binding.");
  return { profile: operation.profile, operationId: operation.operationId, family: "evm", account: operation.walletAddress,
    chain: `eip155:${operation.chainId}`, amountAtomic: operation.amountAtomic,
    asset: asset.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: asset.address } };
}

/** A binding is optional so records written before the gate still validate; once present its lease is mandatory past `started`. */
export function validateEvmAllowlist(operation: OperationRecord): void {
  if (operation.allowlist === undefined) {
    if (operation.allowlistLease !== undefined) corrupt();
    return;
  }
  const binding = validateDirectAllowlistBinding(operation.allowlist);
  if (operation.allowlistLease !== undefined) validateDirectAllowlistLease(operation.allowlistLease, binding, evmAllowlistSubject(operation));
  else if (operation.transitions.some((transition) => transition.state === "started")) corrupt();
}

/** The shared ledger follows the EVM journal: a signature alone stays reserved; a broadcast is charged until proven. */
export function evmUsageTarget(state: OperationState): DirectUsageTarget {
  switch (state) {
    case "awaiting_approval": case "started": case "signed_not_submitted": return "reserved";
    case "submitted_pending": return "submitted";
    case "unknown_finality": return "unknown_finality";
    case "completed": return "finalized";
    case "failed_before_effect": return "failed_before_effect";
    // A confirmed revert, or a different transaction proven final at the nonce, leaves the principal unspent.
    case "failed_confirmed_revert": case "failed_proven_superseded": return "failed_confirmed_revert";
    default: return corrupt();
  }
}

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "The EVM direct allowlist binding is inconsistent with the operation."); }
