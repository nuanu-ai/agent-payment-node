import { isPlainRecord } from "../../canonical.js";
import { isMetaMaskEvmNamespace } from "../../metamask-namespace.js";
import { mmFail } from "../reasons.js";
import { mmProjectWalletsUrl } from "./provider-endpoints.js";
const MAX_WALLETS = 128;
/**
 * A 200 answer of the project's wallet list: an object whose `wallets` holds at most 128 plain rows, each with a string
 * `address` and `namespace` absent or a string. Only EVM rows (namespace absent, "evm" or "eip155") count.
 */
export function readProjectWallets(body, owner) {
    let value;
    try {
        value = JSON.parse(body);
    }
    catch {
        return mmFail("mm_gasless_provider_unavailable");
    }
    if (!isPlainRecord(value) || !Array.isArray(value.wallets) || value.wallets.length > MAX_WALLETS || value.wallets.some(row => !isPlainRecord(row) || typeof row.address !== "string" || !(row.namespace === undefined || typeof row.namespace === "string"))) {
        mmFail("mm_gasless_provider_unavailable");
    }
    const evm = value.wallets
        .filter(row => row.namespace === undefined || isMetaMaskEvmNamespace(row.namespace));
    return { listed: evm.some(row => row.address.toLowerCase() === owner.toLowerCase()), evmCount: evm.length };
}
/**
 * MetaMask keeps server wallets per project, and its CLI keeps a cached wallet list across logins, so the session's own
 * project must list the bound wallet before any quote read. A 404 is a project with no server wallet, as the vendor
 * client reads it. The network policy refuses any other status with the status recorded, and a transport failure
 * propagates as it is, so the read diagnostic names the provider read either way.
 */
export async function assertProjectWallet(policyFetch, state) {
    const response = await policyFetch(mmProjectWalletsUrl(state.projectId), { method: "GET", headers: { authorization: `Bearer ${state.token}` } });
    if (response.status === 404)
        mmFail("mm_gasless_project_has_no_wallets");
    if (response.status !== 200)
        mmFail("mm_gasless_provider_unavailable");
    const wallets = readProjectWallets(await response.text(), state.address);
    if (!wallets.listed)
        mmFail(wallets.evmCount === 0 ? "mm_gasless_project_has_no_wallets" : "mm_gasless_wallet_not_in_project");
}
//# sourceMappingURL=project-wallets.js.map