import { isBaseUsdc, x402AssetOf, type X402Asset } from "./x402-network.js";
import { ApnError } from "./errors.js";
import type { RpcPort, X402RpcPort } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import type {
  SettlementResponseObservation,
  X402OperationRecord,
  X402ProofClass,
  X402Reason,
  X402TerminalState,
  X402SettlementWaitProjection,
} from "./x402-state-integrity.js";

/** The command's explicit --rpc-url; a missing one is refused naming the network it must serve, never substituted. */
export function requireX402Rpc(context: RuntimeContext, asset: X402Asset): RpcPort {
  try { return context.requireRpc(); }
  catch (error) {
    if (!(error instanceof ApnError) || error.code !== "APN_RPC_CONFIG") throw error;
    throw new ApnError("APN_RPC_CONFIG", `This x402 operation reads ${asset.network}: pass --rpc-url with a public HTTPS RPC of chain ${asset.chainId}.`,
      { reason: "x402_rpc_required", chain: asset.network });
  }
}

export function selectX402Rpc(rpc: RpcPort, asset: X402Asset): RpcPort {
  if (isBaseUsdc(asset)) return rpc;
  if (rpc.forX402Network === undefined) throw new ApnError("APN_RPC_CONFIG", "RPC adapter lacks explicit x402 network support.");
  return rpc.forX402Network(asset.chainId, asset.token);
}

export async function assertX402RpcChain(rpc: Partial<X402RpcPort>, chainId = 8453) {
  const chain = await rpc.assertX402Chain?.(chainId);
  if (chain === undefined || chain.chainId !== chainId || !chain.rpcOrigin) {
    throw new ApnError("APN_CHAIN_MISMATCH", `RPC does not prove the frozen x402 network eip155:${chainId}.`, { chain: `eip155:${chainId}` });
  }
  return chain;
}

/** The production RPC adapter always carries the x402 read surface; an adapter without it cannot observe x402. */
export function x402ReadPort(rpc: RpcPort, asset: X402Asset): X402RpcPort {
  const value = selectX402Rpc(rpc, asset) as Partial<X402RpcPort>;
  if (typeof value.getX402Head !== "function" || typeof value.getX402Block !== "function" ||
    typeof value.getX402Receipt !== "function" || typeof value.getX402AuthorizationState !== "function" ||
    typeof value.getX402AuthorizationUsedLogs !== "function") missingX402ReadSurface();
  return value as X402RpcPort;
}

export function boundedX402ReadPort(rpc: RpcPort, timeoutMs: number, asset: X402Asset): X402RpcPort {
  const port = x402ReadPort(rpc, asset);
  if (typeof port.withTotalTimeout !== "function") missingX402ReadSurface();
  return port.withTotalTimeout(timeoutMs);
}

function missingX402ReadSurface(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires the read-only x402 RPC surface.");
}

/**
 * A settlement wait first proves the endpoint's chain (read once per invocation and endpoint). The safe head is not
 * read here: every poll reads it inside authorizationState, and the reconciler ignores a safe head behind the prepared block.
 */
export async function assertWaitRpcProvenance(
  rpc: X402RpcPort,
  operation: X402OperationRecord,
): Promise<void> {
  await assertX402RpcChain(rpc, x402AssetOf(operation).chainId);
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
        : state === "abandoned_unknown"
          ? { reason: "x402_owner_abandoned_unknown", proofClass: "x402_owner_acknowledgement_only" }
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
  return waitOutcome("timeout", seconds, observations);
}

export function waitOutcome(outcome: X402SettlementWaitProjection["outcome"], seconds: number, observations: number): X402SettlementWaitProjection {
  return { outcome, requestedSeconds: seconds.toString(), observationCount: observations.toString() };
}
