import { hashObject } from "../canonical.js";
import { FEE_FORWARDER } from "./abi.js";
import { bridgeDeployment } from "./deployments.js";
import { rpcHexValue } from "./rpc-batch-codec.js";
import { bridgeFailure } from "./validation.js";
/** The identity of the light check. Records frozen by 0.5.41/0.5.42 carry the earlier full-proof identity and stay valid. */
export const BRIDGE_DEPLOYMENT_CHECK = "apn.bridge.deployment-check.v2";
const OWNER_SELECTOR = "0x8da5cb5b", IMPLEMENTATION_SELECTOR = "0x5c60da1b";
/**
 * The deployment facts one effect depends on, read at the head the transaction executes against (P5). The source chain
 * binds what the allowance and the principal flow through: the Diamond's selector routing and fee-forwarder whitelist,
 * the facet's protocol binding (Across spoke, Stargate messaging and pools), the spoke's time buffers that bound the
 * intent's expiry, and owner-settable token fees. Implementation, admin and beacon slots, contract code hashes, the
 * fee forwarder's owner and the Base fee predeploys are not pinned: they change on legitimate upgrades, while exact
 * calldata decoding, the exact-amount allowance, the fresh simulation and the receipt log proofs from the registry's
 * emitters keep the effect bound. A destination cannot touch the source funds and its delivery is proven from its own
 * receipt, so only the BNB composite, whose delivery depends on Fly's router configuration, reads anything there.
 */
export function bridgeDeploymentCheck(chainId, peerChainId, tool, token, role) {
    const contract = bridgeDeployment(chainId, peerChainId, tool, token), composite = role === "destination" && chainId === 56;
    const reads = role === "destination" && !composite ? [] : contract.reads.filter((row) => row.kind === "call" &&
        !row.data.startsWith(IMPLEMENTATION_SELECTOR) && !(row.address.toLowerCase() === FEE_FORWARDER.toLowerCase() && row.data.startsWith(OWNER_SELECTOR)));
    return { chainId, peerChainId, tool, token, role, reads,
        contractHash: hashObject({ check: BRIDGE_DEPLOYMENT_CHECK, chainId, peerChainId, tool, token, role, reads }) };
}
/** The check's reads at the moving head, never cached: each answer must equal its reviewed value. */
export function bridgeDeploymentCheckItems(check) {
    return check.reads.map((row) => ({ method: "eth_call", params: [{ to: row.address, data: row.data }, "latest"], cachePolicy: "none",
        decoder: rpcHexValue(64 * 1024) }));
}
/** Verifies the answers of `bridgeDeploymentCheckItems` (in order) and returns the identity at the observed head. */
export function bridgeDeploymentCheckIdentity(check, values, block, rpcOrigin) {
    if (values.length !== check.reads.length)
        bridgeFailure("APN_RPC_PROTOCOL", "bridge_deployment_check_response");
    const configuration = check.reads.map((row, index) => {
        if (values[index] !== row.expected)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
        return { ...row };
    });
    return { chainId: check.chainId, peerChainId: check.peerChainId, tool: check.tool, block, rpcOrigin,
        contractHash: check.contractHash, codeHash: hashObject([]), configurationHash: hashObject(configuration) };
}
//# sourceMappingURL=deployment-check.js.map