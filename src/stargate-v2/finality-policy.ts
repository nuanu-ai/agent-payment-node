import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";

export type StargateV2FinalityTag = "safe" | "finalized";
export const STARGATE_V2_FINALITY_POLICY_VERSION = "apn.stargate-v2-finality.v1" as const;

const TAG_BY_CHAIN = Object.freeze({
  1: "safe",
  10: "safe",
  130: "safe",
  137: "finalized",
  8453: "safe",
  42161: "safe",
  43114: "safe",
} as const satisfies Readonly<Record<number, StargateV2FinalityTag>>);

export interface StargateV2ChainFinalityPolicy {
  readonly chainId: keyof typeof TAG_BY_CHAIN;
  readonly blockTag: StargateV2FinalityTag;
}

export interface StargateV2RouteFinalityPolicy {
  readonly version: typeof STARGATE_V2_FINALITY_POLICY_VERSION;
  readonly source: StargateV2ChainFinalityPolicy;
  readonly destination: StargateV2ChainFinalityPolicy;
}

export function stargateV2ChainFinalityPolicy(chainId: number): StargateV2ChainFinalityPolicy {
  const blockTag = TAG_BY_CHAIN[chainId as keyof typeof TAG_BY_CHAIN];
  if (blockTag === undefined) throw new ApnError("APN_RPC_CONFIG", "Stargate finality policy does not admit this chain.", { chainId: String(chainId) });
  return Object.freeze({ chainId: chainId as keyof typeof TAG_BY_CHAIN, blockTag });
}

export function stargateV2RouteFinalityPolicy(sourceChainId: number, destinationChainId: number): StargateV2RouteFinalityPolicy {
  return Object.freeze({ version: STARGATE_V2_FINALITY_POLICY_VERSION,
    source: stargateV2ChainFinalityPolicy(sourceChainId), destination: stargateV2ChainFinalityPolicy(destinationChainId) });
}

export function assertStargateV2RouteFinalityPolicy(value: unknown, sourceChainId: number, destinationChainId: number): asserts value is StargateV2RouteFinalityPolicy {
  if (canonicalJson(value) !== canonicalJson(stargateV2RouteFinalityPolicy(sourceChainId, destinationChainId))) {
    throw new ApnError("APN_STATE_CORRUPT", "The frozen Stargate finality policy does not match the pinned chain policy.");
  }
}
