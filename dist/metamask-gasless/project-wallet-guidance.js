import { ApnError } from "../errors.js";
import { metaMaskCommand } from "../metamask-command.js";
import { canonicalProfile } from "../wallet-policy.js";
export function mmProjectWalletReason(reason) {
    return reason === "mm_gasless_project_has_no_wallets" || reason === "mm_gasless_wallet_not_in_project";
}
/**
 * The owner's two ways forward, each step runnable as typed. Signing in with the account that created the wallet keeps
 * the bound address, so its connect needs no revision; any other wallet is a new address, so its connect names the
 * current revision (a rebind). Neither moves funds. `mm init` creates a wallet only in a project that has none: in one
 * that has some it selects one of them and keeps its server-side trading mode. When the pinned client cannot be
 * resolved its steps keep the bare `mm`, as the native transfer refusals do.
 */
export async function mmProjectWalletNextActions(refusal) {
    let mm;
    try {
        mm = await metaMaskCommand();
    }
    catch {
        mm = "mm";
    }
    const { address, revision, otherWallets } = refusal;
    const connect = `apn wallet connect --profile ${canonicalProfile(refusal.profile)} --provider metamask-agent-wallet --auth-method browser`;
    const rebind = `${connect} --expected-revision ${revision}`;
    const keep = `To keep paying from ${address}, sign in to MetaMask with the account that created it: ${mm} logout, then ${mm} login ` +
        `(then ${mm} wallet select ${address} if that account holds more than one wallet), then connect this profile again with ` +
        `${connect}. The address stays the same, so no revision is needed.`;
    if (refusal.reason === "mm_gasless_project_has_no_wallets")
        return [keep,
            `Or create this project's first server wallet with ${mm} init --wallet server-wallet --mode guard --json and connect it with ` +
                `${rebind}. That is a new address: funds on ${address} stay with the login that created it.`];
    const which = otherWallets === undefined ? "the other EVM server wallets"
        : `the ${otherWallets} other EVM server wallet${otherWallets === 1 ? "" : "s"}`;
    return [keep, `Or pay from ${which} this login's project holds instead of ${address}: ${mm} init would only select one of ` +
            `them (it creates no wallet) and keep that wallet's server-side trading mode. List them with ${mm} wallet list, select one ` +
            `with ${mm} wallet select, then connect it with ${rebind}. Funds on ${address} stay with the login that created it.`];
}
/** A prepare refused for the login's project: the provider's answer with both ways forward. */
export async function mmProjectWalletGuidance(error, profile) {
    const d = error instanceof ApnError ? error.details : undefined, count = d?.mm_read_project_wallet_count;
    if (!(error instanceof ApnError) || d === undefined || !mmProjectWalletReason(d.reason) || typeof d.wallet_address !== "string" ||
        typeof d.profile_revision !== "number" || !Number.isSafeInteger(d.profile_revision) || d.profile_revision < 1)
        return error;
    return new ApnError(error.code, error.message, { ...d, nextActions: await mmProjectWalletNextActions({ reason: d.reason, profile,
            address: d.wallet_address, revision: d.profile_revision, otherWallets: typeof count === "number" ? count : undefined }) });
}
//# sourceMappingURL=project-wallet-guidance.js.map