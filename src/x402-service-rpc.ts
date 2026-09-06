import type { EvmChainId } from "./evm-asset.js";
import { x402Network } from "./x402-network.js";
import { ApnError } from "./errors.js";
import type { RpcPort, X402RpcPort } from "./ports.js";
import type {
  SettlementResponseObservation,
  X402OperationRecord,
  X402ProofClass,
  X402Reason,
  X402TerminalState,
  X402SettlementWaitProjection,
} from "./x402-state-integrity.js";

export function selectX402Rpc(rpc: RpcPort, chainId: EvmChainId = 8453): RpcPort {
  x402Network(chainId);
  if (chainId === 8453) return rpc;
  if (rpc.forX402Network === undefined) throw new ApnError("APN_RPC_CONFIG", "RPC adapter lacks explicit x402 network support.");
  return rpc.forX402Network(chainId);
}

export function boundedX402PrepareRpc(rpc: RpcPort, timeoutMs: number): Pick<RpcPort, "assertBaseChain" | "getX402PrepareEvidence"> & Partial<X402RpcPort> {
  const bounded = (rpc as Partial<X402RpcPort>).withTotalTimeout?.(timeoutMs);
  if (bounded === undefined || typeof (bounded as Partial<RpcPort>).getX402PrepareEvidence !== "function") {
    throw new ApnError("APN_RPC_CONFIG", "Bounded first-exposure checks require network-aware prepare reads.");
  }
  return bounded as X402RpcPort & Pick<RpcPort, "getX402PrepareEvidence">;
}

export async function assertX402RpcChain(rpc: Pick<RpcPort, "assertBaseChain"> & Partial<X402RpcPort>, chainId: EvmChainId = 8453) {
  const chain = rpc.assertX402Chain === undefined && chainId === 8453 ? await rpc.assertBaseChain() :
    await rpc.assertX402Chain?.(chainId);
  if (chain === undefined || chain.chainId !== chainId || !chain.rpcOrigin) {
    throw new ApnError("APN_CHAIN_MISMATCH", "RPC does not prove the frozen x402 network.");
  }
  return chain;
}

export function x402ReadPort(rpc: RpcPort, chainId: EvmChainId = 8453): X402RpcPort | null {
  const value = selectX402Rpc(rpc, chainId) as Partial<X402RpcPort>;
  return typeof value.getX402Head === "function" && typeof value.getX402Block === "function" &&
    typeof value.getX402Receipt === "function" && typeof value.getX402AuthorizationState === "function" &&
    typeof value.getX402AuthorizationUsedLogs === "function" ? value as X402RpcPort : null;
}

export function boundedX402ReadPort(rpc: RpcPort, timeoutMs: number, chainId: EvmChainId = 8453): X402RpcPort | null {
  const port = x402ReadPort(rpc, chainId);
  if (port === null || typeof port.withTotalTimeout !== "function") return null;
  return port.withTotalTimeout(timeoutMs);
}

export async function assertWaitRpcProvenance(
  rpc: X402RpcPort,
  operation: X402OperationRecord,
): Promise<void> {
  const chain = await assertX402RpcChain(rpc, x402Network(operation.network).chainId);
  const safe = await rpc.getX402Head("safe");
  const observedAt = Date.parse(safe.observedAt);
  if (
    safe.queriedTag !== "safe" || safe.rpcOrigin !== chain.rpcOrigin ||
    !/^(?:0|[1-9][0-9]*)$/u.test(safe.number) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(safe.timestamp) ||
    !/^0x[0-9a-f]{64}$/u.test(safe.hash) || /^0x0{64}$/u.test(safe.hash) ||
    !Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== safe.observedAt ||
    BigInt(safe.timestamp) > BigInt(Math.floor(observedAt / 1_000)) ||
    BigInt(safe.number) < BigInt(operation.preparedBlock.number)
  ) {
    throw new ApnError("APN_RPC_PROTOCOL", "Settlement wait RPC provenance is unsafe.");
  }
}

export function isRecoverableX402RpcObservationFailure(error: unknown): boolean {
  return error instanceof ApnError && [
    "APN_RPC_AMBIGUOUS",
    "APN_RPC_PROTOCOL",
    "APN_RPC_CONFIG",
    "APN_CHAIN_MISMATCH",
  ].includes(error.code);
}

export function isPostExposureWaitState(operation: X402OperationRecord): boolean {
  return operation.attempts.some((attempt) => attempt.purpose === "payment") && [
    "paid_request_pending",
    "settlement_pending",
    "effect_unknown",
    "seller_result_recovery_pending",
  ].includes(operation.state);
}

export function terminalClassification(state: X402TerminalState): {
  readonly reason: X402Reason;
  readonly proofClass: X402ProofClass;
} {
  return state === "completed"
    ? { reason: "x402_completed", proofClass: "x402_safe_settlement" }
    : state === "failed_before_effect"
      ? { reason: "x402_failed_before_effect", proofClass: "x402_proven_no_effect" }
      : state === "failed_expired_unused"
        ? { reason: "x402_failed_expired_unused", proofClass: "x402_expired_unused_finalized" }
        : { reason: "x402_failed_settled_without_result", proofClass: "x402_settled_result_unavailable" };
}

export function settlementResponseTransaction(response: SettlementResponseObservation): string | undefined {
  try {
    const value = JSON.parse(response.normalizedCanonicalJson) as { readonly transaction?: unknown };
    return typeof value.transaction === "string" ? value.transaction : undefined;
  } catch {
    return undefined;
  }
}

export function remainingWaitMs(deadline: number, nowMs: number): number {
  return Math.floor(deadline - nowMs);
}

export function waitTimeout(seconds: number, observations: number): X402SettlementWaitProjection {
  return { outcome: "timeout", requestedSeconds: seconds.toString(), observationCount: observations.toString() };
}
