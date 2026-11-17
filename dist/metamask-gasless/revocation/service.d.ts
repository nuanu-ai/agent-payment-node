import type { StateStore } from "../../state.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";
import type { MetaMaskGaslessRpcFactory } from "../ports.js";
import { type MetaMaskRevocationApprovalPort } from "./consent.js";
import { type MetaMaskRevocationReferencesPort } from "./requests.js";
import { type MetaMaskRevocationWalletPort } from "./wallet.js";
export interface MetaMaskRevocationDependencies {
    readonly approval?: MetaMaskRevocationApprovalPort;
    readonly wallet?: MetaMaskRevocationWalletPort;
    /**
     * Seals each disable's request id before it is sent, and removes that seal when the request provably never left the
     * machine (provider-request-reference-store.ts, lane `metamask-revocation`).
     */
    readonly references?: MetaMaskRevocationReferencesPort;
}
/**
 * The owner's exit for a disclosed delegation whose outcome no proof decides: one `disableDelegation` of exactly that
 * delegation, signed and paid by its own server wallet after foreground consent. It records nothing in the operation:
 * the chain is the record, and `operation resume` closes the operation only from the manager's disabled flag with the
 * redemption count 0 at one finality block. APN names the MetaMask request id and seals it (revocation/requests.ts)
 * under the operation lock, after the wallet's own check and right before the send, so `operation resume` can read that
 * request's MetaMask status again; a seal that fails sends nothing. A request whose helper provably stopped before any
 * network call never reached MetaMask, so its seal is removed again under the same locks. There is no limit on the
 * number of disables. The wrapping secret is read before consent, so a refusing Keychain stops before the owner's
 * screen. Repeating it can never move USDC. Each call pins the pending nonce it was priced at, so two calls at one
 * nonce land at most once; a call priced after another landed fails its gas estimate and is not sent. Gas is lost only
 * when a call is priced before another lands and is sent after it (`AlreadyDisabled`).
 * `assertAvailable` refuses while an operation that may use the server wallet's own account is unresolved; it runs under
 * the account's evm-owner lock, before pricing and again with the send.
 */
export declare function revokeMetaMaskGasless(state: StateStore, op: MetaMaskGaslessOperationRecord, rpcFor: MetaMaskGaslessRpcFactory, dependencies: MetaMaskRevocationDependencies, assertAvailable: () => Promise<void>): Promise<Readonly<Record<string, unknown>>>;
