import type { PrivateState } from "./private-state.js";
/** Whether the project lists the bound address among its EVM server wallets, and how many it lists; no address is kept. */
export interface ProjectWallets {
    readonly listed: boolean;
    readonly evmCount: number;
}
/**
 * A 200 answer of the project's wallet list: an object whose `wallets` holds at most 128 plain rows, each with a string
 * `address` and `namespace` absent or a string. Only EVM rows (namespace absent, "evm" or "eip155") count.
 */
export declare function readProjectWallets(body: string, owner: string): ProjectWallets;
/**
 * MetaMask keeps server wallets per project, and its CLI keeps a cached wallet list across logins, so the session's own
 * project must list the bound wallet before any quote read. A 404 is a project with no server wallet, as the vendor
 * client reads it. The network policy refuses any other status with the status recorded, and a transport failure
 * propagates as it is, so the read diagnostic names the provider read either way.
 */
export declare function assertProjectWallet(policyFetch: typeof globalThis.fetch, state: Pick<PrivateState, "projectId" | "token" | "address">): Promise<void>;
