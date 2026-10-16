import type { Address } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeDeploymentContract, BridgeDeploymentIdentity, BridgeTool } from "./model.js";
import type { RpcBatchReadItem } from "./rpc-session.js";
/** The identity of the light check. Records frozen by 0.5.41/0.5.42 carry the earlier full-proof identity and stay valid. */
export declare const BRIDGE_DEPLOYMENT_CHECK: "apn.bridge.deployment-check.v2";
type CheckRead = BridgeDeploymentContract["reads"][number];
type PlannedRead = Omit<RpcBatchReadItem, "batchAttempt">;
export interface BridgeDeploymentCheck {
    readonly chainId: BridgeChainId;
    readonly peerChainId: BridgeChainId;
    readonly tool: BridgeTool;
    readonly token: Address;
    readonly role: "source" | "destination";
    readonly reads: readonly CheckRead[];
    /** The BNB composite destination also proves its Balancer pool registration and tokens. */
    readonly bnbPool: boolean;
    readonly contractHash: string;
}
/**
 * The deployment facts one effect depends on, read at the head the transaction executes against (P5). The source chain
 * binds what the allowance and the principal flow through: the Diamond's selector routing and fee-forwarder whitelist,
 * the facet's protocol binding (Across spoke, Stargate messaging and pools), the spoke's time buffers that bound the
 * intent's expiry, and owner-settable token fees. Implementation, admin and beacon slots, contract code hashes, the
 * fee forwarder's owner and the Base fee predeploys are not pinned: they change on legitimate upgrades, while exact
 * calldata decoding, the exact-amount allowance, the fresh simulation and the receipt log proofs from the registry's
 * emitters keep the effect bound. A destination cannot touch the source funds and its delivery is proven from its own
 * receipt, so only the BNB composite, whose delivery depends on third-party routing configuration, reads anything there.
 */
export declare function bridgeDeploymentCheck(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address, role: "source" | "destination"): BridgeDeploymentCheck;
/** The check's reads at the moving head, never cached: each answer must equal its reviewed value. */
export declare function bridgeDeploymentCheckItems(check: BridgeDeploymentCheck): readonly PlannedRead[];
/** Verifies the answers of `bridgeDeploymentCheckItems` (in order) and returns the identity at the observed head. */
export declare function bridgeDeploymentCheckIdentity(check: BridgeDeploymentCheck, values: readonly unknown[], block: BridgeBlock, rpcOrigin: string): BridgeDeploymentIdentity;
export {};
