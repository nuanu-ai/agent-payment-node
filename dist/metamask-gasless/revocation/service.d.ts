import type { StateStore } from "../../state.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";
import type { MetaMaskGaslessRpcFactory } from "../ports.js";
import { type MetaMaskRevocationApprovalPort } from "./consent.js";
import type { MetaMaskRevocationWalletPort } from "./wallet.js";
export interface MetaMaskRevocationDependencies {
    readonly approval?: MetaMaskRevocationApprovalPort;
    readonly wallet?: MetaMaskRevocationWalletPort;
}
/**
 * The owner's exit for a disclosed delegation whose outcome no proof decides: one `disableDelegation` of exactly that
 * delegation, signed and paid by its own server wallet after foreground consent. It records nothing in the operation:
 * the chain is the record, and `operation resume` closes the operation only from the manager's disabled flag with the
 * redemption count 0 at one finality block. Repeating it can never move USDC; the pinned nonce lets one call land.
 */
export declare function revokeMetaMaskGasless(state: StateStore, op: MetaMaskGaslessOperationRecord, rpcFor: MetaMaskGaslessRpcFactory, dependencies: MetaMaskRevocationDependencies): Promise<Readonly<Record<string, unknown>>>;
