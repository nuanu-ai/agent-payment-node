import { hashObject } from "../canonical.js";
import { bridgeDeployment } from "./deployments.js";
import { bridgeApprovalPolicyBinding } from "./economics.js";
import type { BridgeOperationRecord } from "./operation-model.js";

export type BridgeRpcPhysicalPolicy = "default" | "canonical_wbtc_across_approval_continuation";
export const WBTC_ACROSS_CONTINUATION_POST_LIMIT = 33;
const ETH_WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const ARB_WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";

/** Only the reviewed two-chain WBTC continuation needs historical approval plus both fresh guards in one invocation. */
export function bridgeRpcPhysicalPolicy(op: BridgeOperationRecord): BridgeRpcPhysicalPolicy {
  const { intent: i, effects } = op, m = i.materialization, r = m.request;
  const exactPair = r.fromChainId === 1 && r.toChainId === 42161 && r.fromToken === ETH_WBTC && r.toToken === ARB_WBTC ||
    r.fromChainId === 42161 && r.toChainId === 1 && r.fromToken === ARB_WBTC && r.toToken === ETH_WBTC;
  if (op.terminal || m.tool !== "across" || !exactPair || effects.length !== 2 || effects[0]!.role !== "approval" ||
    effects[0]!.submissionAttempts !== 1 || effects[0]!.safeProof !== null ||
    !["submitting", "submitted_pending", "unknown_finality", "included_success"].includes(effects[0]!.phase) || effects[1]!.role !== "bridge" ||
    effects[1]!.submissionAttempts !== 0 || !["unsealed", "signing_started", "sealed"].includes(effects[1]!.phase) || bridgeApprovalPolicyBinding(m, i.policyHash, i.preparedAt) !== "full-refresh") return "default";
  // Do not assign extra capacity to an old/unreviewed deployment or a token/address lookalike.
  const source = bridgeDeployment(r.fromChainId, r.toChainId, "across", r.fromToken);
  const destination = bridgeDeployment(r.toChainId, r.fromChainId, "across", r.toToken);
  return i.sourceDeployment.contractHash === hashObject({ protocol: source, feeContract: { code: [], reads: [] } }) && i.sourceDeployment.codeHash === hashObject(source.code) &&
    i.sourceDeployment.configurationHash === hashObject(source.reads) && i.destinationDeployment.contractHash === hashObject({ protocol: destination, feeContract: { code: [], reads: [] } }) &&
    i.destinationDeployment.codeHash === hashObject(destination.code) && i.destinationDeployment.configurationHash === hashObject(destination.reads)
    ? "canonical_wbtc_across_approval_continuation" : "default";
}
