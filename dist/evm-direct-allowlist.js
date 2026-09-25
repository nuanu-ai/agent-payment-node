import { refuse, requireListedDirectAsset, validateDirectAllowlistBinding, validateDirectAllowlistLease } from "./direct-allowlist-gate.js";
import { ApnError } from "./errors.js";
import { evmToken } from "./evm-asset.js";
import { directEvmListRows, directEvmNetworkByCaip2 } from "./evm-direct-networks.js";
/**
 * Direct EVM transfers accept only frozen-list networks and pinned direct contracts. This runs in the CLI/MCP binder and
 * again at prepare, before any RPC, custody or signing call.
 */
export function listedEvmAsset(chainValue, tokenValue, decimals) {
    const chain = typeof chainValue === "number" ? `eip155:${chainValue}` : chainValue;
    if (typeof chain !== "string" || !/^eip155:[1-9][0-9]{0,77}$/u.test(chain)) {
        throw new ApnError("APN_INVALID_INPUT", "Select an EVM network by its exact CAIP-2 identity.");
    }
    const token = evmToken(tokenValue);
    const row = requireListedDirectAsset(chain, token === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: token });
    if (decimals !== undefined && decimals !== row.decimals) {
        refuse("allowlist_decimals_mismatch", "The supplied decimals differ from the pinned direct row for this asset.", { chain, decimals: String(row.decimals) });
    }
    const network = directEvmNetworkByCaip2(chain);
    if (network === undefined) {
        refuse("allowlist_network_not_enabled", "The network is on the frozen allowlist, but APN direct EVM transfers are not enabled on it yet.", { chain });
    }
    // The registry's native coin is cross-checked against the list on every selection, never assumed.
    directEvmListRows(network.chainId);
    return { selection: { chainId: network.chainId, token, ...(decimals === undefined ? {} : { decimals }) }, decimals: row.decimals };
}
export function evmAllowlistSubject(operation) {
    const asset = operation.evm?.asset;
    if (asset === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Only an explicit EVM asset transfer carries a direct allowlist binding.");
    return { profile: operation.profile, operationId: operation.operationId, family: "evm", account: operation.walletAddress,
        chain: `eip155:${operation.chainId}`, amountAtomic: operation.amountAtomic,
        asset: asset.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: asset.address } };
}
/** A binding is optional so records written before the gate still validate; once present its lease is mandatory past `started`. */
export function validateEvmAllowlist(operation) {
    if (operation.allowlist === undefined) {
        if (operation.allowlistLease !== undefined)
            corrupt();
        return;
    }
    const binding = validateDirectAllowlistBinding(operation.allowlist);
    if (operation.allowlistLease !== undefined)
        validateDirectAllowlistLease(operation.allowlistLease, binding, evmAllowlistSubject(operation));
    else if (operation.transitions.some((transition) => transition.state === "started"))
        corrupt();
}
/** The shared ledger follows the EVM journal: a signature alone stays reserved; a broadcast is charged until proven. */
export function evmUsageTarget(state) {
    switch (state) {
        case "awaiting_approval":
        case "started":
        case "signed_not_submitted": return "reserved";
        case "submitted_pending": return "submitted";
        case "unknown_finality": return "unknown_finality";
        case "completed": return "finalized";
        case "failed_before_effect": return "failed_before_effect";
        // A confirmed revert, or a different transaction proven final at the nonce, leaves the principal unspent.
        case "failed_confirmed_revert":
        case "failed_proven_superseded": return "failed_confirmed_revert";
        default: return corrupt();
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The EVM direct allowlist binding is inconsistent with the operation."); }
//# sourceMappingURL=evm-direct-allowlist.js.map