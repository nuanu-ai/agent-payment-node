import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { FEE_FORWARDER } from "./abi.js";
import { bnbPoolReadData, BNB_COMPOSITE, verifyBnbPoolConfiguration } from "./bnb-composite.js";
import type { BridgeChainId } from "./chains.js";
import { bridgeDeployment } from "./deployments.js";
import type { BridgeBlock, BridgeDeploymentContract, BridgeDeploymentIdentity, BridgeTool } from "./model.js";
import { rpcHexValue } from "./rpc-batch-codec.js";
import type { RpcBatchReadItem } from "./rpc-session.js";
import { bridgeFailure } from "./validation.js";
import { canonicalJson } from "../canonical.js";

/** The identity of the light check. Records frozen by 0.5.41/0.5.42 carry the earlier full-proof identity and stay valid. */
export const BRIDGE_DEPLOYMENT_CHECK = "apn.bridge.deployment-check.v2" as const;
const OWNER_SELECTOR = "0x8da5cb5b", IMPLEMENTATION_SELECTOR = "0x5c60da1b";
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
export function bridgeDeploymentCheck(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address,
  role: "source" | "destination"): BridgeDeploymentCheck {
  const contract = bridgeDeployment(chainId, peerChainId, tool, token), bnbPool = role === "destination" && chainId === 56;
  const reads = role === "destination" && !bnbPool ? [] : contract.reads.filter((row) => row.kind === "call" &&
    !row.data.startsWith(IMPLEMENTATION_SELECTOR) && !(row.address.toLowerCase() === FEE_FORWARDER.toLowerCase() && row.data.startsWith(OWNER_SELECTOR)));
  return { chainId, peerChainId, tool, token, role, reads, bnbPool,
    contractHash: hashObject({ check: BRIDGE_DEPLOYMENT_CHECK, chainId, peerChainId, tool, token, role, reads }) };
}

/** The check's reads at the moving head, never cached: each answer must equal its reviewed value. */
export function bridgeDeploymentCheckItems(check: BridgeDeploymentCheck): readonly PlannedRead[] {
  return [
    ...check.reads.map((row): PlannedRead => ({ method: "eth_call", params: [{ to: row.address, data: row.data }, "latest"], cachePolicy: "none",
      decoder: rpcHexValue(64 * 1024) })),
    ...(check.bnbPool ? [
      { method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.registration }, "latest"], cachePolicy: "none" as const, decoder: rpcHexValue(256) },
      { method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens }, "latest"], cachePolicy: "none" as const, decoder: rpcHexValue(2048) },
    ] : []),
  ];
}

/** Verifies the answers of `bridgeDeploymentCheckItems` (in order) and returns the identity at the observed head. */
export function bridgeDeploymentCheckIdentity(check: BridgeDeploymentCheck, values: readonly unknown[], block: BridgeBlock,
  rpcOrigin: string): BridgeDeploymentIdentity {
  if (values.length !== check.reads.length + (check.bnbPool ? 2 : 0)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_deployment_check_response");
  const configuration: Array<{ kind: string; address: Address; data: Hex; expected: Hex }> = check.reads.map((row, index) => {
    if (values[index] !== row.expected) bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
    return { ...row };
  });
  if (check.bnbPool) {
    const pool = verifyBnbPoolConfiguration(values[check.reads.length] as Hex, values[check.reads.length + 1] as Hex);
    configuration.push({ kind: "pool", address: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens,
      expected: `0x${Buffer.from(canonicalJson(pool)).toString("hex")}` as Hex });
  }
  return { chainId: check.chainId, peerChainId: check.peerChainId, tool: check.tool, block, rpcOrigin,
    contractHash: check.contractHash, codeHash: hashObject([]), configurationHash: hashObject(configuration) };
}
