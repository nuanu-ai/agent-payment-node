import { hashObject } from "../canonical.js";
import type { Hex } from "../model.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import type { BridgeDeploymentIdentity, BridgeDestinationTransactionProof, BridgeTransactionProof } from "./model.js";
import { retainedUnsentBridgeRpcFailure, type BridgeEffect, type BridgeMutable, type BridgeOperationRecord, type BridgeVerifiedDestinationProof } from "./operation-model.js";
import type { BridgeRpcPort, LifiProviderPort } from "./ports.js";
import { bridgeDestinationProof, bridgeSourceProof, validateBnbFilledRelay } from "./protocol-evidence.js";
import { bridgeDeployment, bridgeProtocolEmitter } from "./deployments.js";
import { BNB_COMPOSITE } from "./bnb-composite.js";
import { bridgeProviderBoundNativeDestination } from "./asset-registry.js";
import { approvalIncluded } from "./transaction.js";
import { bridgeFailure, bridgeSame } from "./validation.js";
import { ApnError, type ErrorCode } from "../errors.js";
import { observationRpcFailure } from "./observation-diagnostics.js";
import type { RpcReadTelemetry } from "./rpc.js";

export type BridgeSave = (op: BridgeOperationRecord, patch: Partial<BridgeMutable>) => Promise<BridgeOperationRecord>;
type LazyRpc = BridgeRpcPort | (() => BridgeRpcPort);
export class BridgeObservation {
  constructor(private readonly sourcePort: LazyRpc, private readonly destinationPort: LazyRpc,
    private readonly provider: LifiProviderPort, private readonly save: BridgeSave,
    private readonly residualPort: LazyRpc = sourcePort) {}

  private source() { return typeof this.sourcePort === "function" ? this.sourcePort() : this.sourcePort; }
  private destination() { return typeof this.destinationPort === "function" ? this.destinationPort() : this.destinationPort; }
  private residualSource() { return typeof this.residualPort === "function" ? this.residualPort() : this.residualPort; }

  async sources(op: BridgeOperationRecord): Promise<{ operation: BridgeOperationRecord; reliable: boolean }> {
    let reliable = true;
    for (const savedEffect of op.effects) {
      if (savedEffect.submissionAttempts === 0) continue;
      const effect = op.effects.find((e) => e.role === savedEffect.role)!;
      if (effect.phase === "safe_success" && effect.safeProof !== null &&
        (effect.role !== "bridge" || op.sourceProof !== null)) continue;
      let observation: Awaited<ReturnType<BridgeRpcPort["observe"]>>;
      const source = this.source(), beforeTelemetry = source.readTelemetry?.() ?? null;
      try {
        observation = await source.observe(effect.transactionHash!, effect.envelope);
        if (observation !== null) {
          await this.historicalDeployment(op, source, observation.transaction, op.intent.sourceDeployment);
          if (observation.transaction.status === "success" && effect.role === "approval") {
            const m = op.intent.materialization;
            approvalIncluded(observation.receipt, m.request.fromToken, m.sender, m.approvalAddress, m.request.amountAtomic);
          }
        }
      } catch (error) {
        reliable = false;
        op = await this.save(op, { state: "unknown_finality", observationTelemetry: appendObservationTelemetry(op, "source_observation", effect.role, "failure", beforeTelemetry,
          source.readTelemetry?.() ?? null), failure: retainedUnsentBridgeRpcFailure(op) ?? observationFailure(effect.role, error, "APN_INTERNAL") });
        continue;
      }
      if (observation === null) {
        const observedTelemetry = appendObservationTelemetry(op, "source_observation", effect.role, "missing", beforeTelemetry,
          source.readTelemetry?.() ?? null);
        reliable = false;
        if (effect.safeProof !== null) {
          op = await this.save(op, { state: "unknown_finality", observationTelemetry: observedTelemetry, failure: retainedUnsentBridgeRpcFailure(op) ?? {
            ...observationFailure(effect.role, null, "APN_RECEIPT_NOT_FOUND"), reason: "safe_source_observation_conflict" } });
        } else {
          op = await this.save(op, { state: "unknown_finality", observationTelemetry: observedTelemetry, effects: replaceEffect(op, {
            ...effect, phase: "unknown_finality", includedProof: null, safeProof: null,
          }), ...(effect.role === "bridge" ? { sourceProof: null } : {}),
          failure: retainedUnsentBridgeRpcFailure(op) ?? observationFailure(effect.role, null, "APN_RECEIPT_NOT_FOUND") });
        }
        continue;
      }
      const { transaction, receipt } = observation;
      if (effect.safeProof !== null) {
        const observedTelemetry = appendObservationTelemetry(op, "source_observation", effect.role, "success", beforeTelemetry,
          source.readTelemetry?.() ?? null);
        if (transaction.safeBlock === null || !bridgeSame(proofIdentity(effect.safeProof), proofIdentity(transaction))) {
          reliable = false;
          op = await this.save(op, { state: "unknown_finality", observationTelemetry: observedTelemetry,
            failure: retainedUnsentBridgeRpcFailure(op) ?? { reason: "safe_source_observation_conflict", residualAllowance: null } });
        }
        continue;
      }
      // An inclusion can disappear or move before safe finality. Preserve that change in a separate journal entry.
      if (effect.includedProof !== null && !bridgeSame(proofIdentity(effect.includedProof), proofIdentity(transaction))) {
        op = await this.save(op, { state: "unknown_finality", effects: replaceEffect(op, {
          ...effect, phase: "unknown_finality", includedProof: null, safeProof: null,
        }), ...(effect.role === "bridge" ? { sourceProof: null } : {}) });
      }
      const current = op.effects.find((e) => e.role === effect.role)!;
      const phase = `${transaction.safeBlock === null ? "included" : "safe"}_${transaction.status === "success" ? "success" : "revert"}` as BridgeEffect["phase"];
      let sourceProof = op.sourceProof;
      if (effect.role === "bridge" && transaction.status === "success") {
        try { sourceProof = bridgeSourceProof(op.intent.materialization, op.intent.decoded, receipt); }
        catch (error) {
          reliable = false;
          op = await this.save(op, { state: "unknown_finality", observationTelemetry: appendObservationTelemetry(op, "source_observation",
            effect.role, "failure", beforeTelemetry, source.readTelemetry?.() ?? null),
            failure: { reason: "source_protocol_evidence_unavailable", residualAllowance: null,
              observationRpc: observationRpcFailure("source", effect.role, sourceProofDiagnostic(error), "APN_RPC_PROTOCOL") } });
          continue;
        }
      }
      op = await this.save(op, { state: reliable ? "source_pending" : "unknown_finality", sourceProof,
        observationTelemetry: appendObservationTelemetry(op, "source_observation", effect.role, "success", beforeTelemetry,
          source.readTelemetry?.() ?? null),
        failure: reliable ? retainedUnsentBridgeRpcFailure(op) : op.failure, effects: replaceEffect(op, {
        ...current, phase, includedProof: transaction, safeProof: transaction.safeBlock === null ? null : transaction,
      }) });
    }
    return { operation: op, reliable };
  }

  async destinationProof(op: BridgeOperationRecord): Promise<BridgeOperationRecord> {
    if (op.sourceProof === null || op.effects.some((e) => e.phase !== "safe_success")) return op;
    if (op.destinationProof !== null) {
      return await this.finish(op);
    }
    const m = op.intent.materialization;
    if (!reusableProviderObservation(op)) {
      let observation = null;
      try {
        observation = await this.provider.status({ transactionHash: op.sourceProof.transactionHash, tool: m.tool,
          fromChainId: m.request.fromChainId, toChainId: m.request.toChainId });
      } catch { /* Provider availability is independent of canonical chain evidence. */ }
      if (observation !== null) op = await this.save(op, { providerObservation: observation });
    }
    const hint = op.providerObservation?.destinationTransactionHash;
    const providerBoundNative = bridgeProviderBoundNativeDestination(m.request);
    if (providerBoundNative) {
      if (op.providerObservation?.status !== "completed_observed" || !isEvmTransactionHash(hint)) return await this.waiting(op);
      const destination = this.destination(), beforeTelemetry = destination.readTelemetry?.() ?? null;
      let proof: BridgeVerifiedDestinationProof;
      try {
        proof = await this.destinationCandidate(op, hint, destination);
      } catch (error) {
        const telemetry = appendObservationTelemetry(op, "destination_observation", "bridge",
          error instanceof DestinationPending ? "missing" : "failure", beforeTelemetry, destination.readTelemetry?.() ?? null);
        if (error instanceof DestinationPending) return await this.waiting(op, telemetry);
        if (error instanceof BnbProtocolMismatch) return await this.finishDestinationFailure(await this.save(op, { observationTelemetry: telemetry }), "protocol_mismatch");
        return await this.save(op, { state: "unknown_finality", observationTelemetry: telemetry,
          failure: destinationObservationFailure("evidence_unavailable", error) });
      }
      op = await this.save(op, { destinationProof: proof, observationTelemetry: appendObservationTelemetry(op, "destination_observation",
        "bridge", "success", beforeTelemetry, destination.readTelemetry?.() ?? null) });
      const outcome = proof.compositeTrace?.outcome;
      if (outcome === undefined || outcome === null || outcome === "completed_native") return await this.finish(op, outcome ?? "delivery_correlated");
      if (outcome === "recovered_weth" || outcome === "below_floor" || outcome === "protocol_mismatch") return await this.finishDestinationFailure(op, outcome);
      return await this.save(op, { state: "unknown_finality", failure: { reason: "evidence_unavailable", residualAllowance: null } });
    }
    // Destination correlation is bound to the provider-named transaction and its canonical receipt logs.
    if (isEvmTransactionHash(hint)) {
      let proof: BridgeVerifiedDestinationProof | null = null;
      const destination = this.destination(), beforeTelemetry = destination.readTelemetry?.() ?? null;
      try { proof = await this.destinationCandidate(op, hint, destination); }
      catch (error) {
        const telemetry = appendObservationTelemetry(op, "destination_observation", "bridge",
          error instanceof DestinationPending ? "missing" : "failure", beforeTelemetry, destination.readTelemetry?.() ?? null);
        if (error instanceof DestinationPending) return await this.waiting(op, telemetry);
        return await this.save(op, { state: "unknown_finality", observationTelemetry: telemetry,
          failure: destinationObservationFailure("destination_observation_unavailable", error) });
      }
      if (proof !== null) return await this.finish(await this.save(op, { destinationProof: proof,
        observationTelemetry: appendObservationTelemetry(op, "destination_observation", "bridge", "success", beforeTelemetry,
          destination.readTelemetry?.() ?? null) }));
    }
    return await this.waiting(op);
  }

  async residual(op: BridgeOperationRecord) {
    const observed = await this.residualObservation(op);
    if (!observed.ok) throw observed.error;
    return observed.value;
  }
  async residualObservation(op: BridgeOperationRecord) {
    const source = this.residualSource(), beforeTelemetry = source.readTelemetry?.() ?? null;
    try {
      const value = await this.residualFrom(op, source);
      return { ok: true as const, value, observationTelemetry: appendObservationTelemetry(op, "residual_observation", "bridge", "success",
        beforeTelemetry, source.readTelemetry?.() ?? null) };
    } catch (error) {
      return { ok: false as const, error, observationTelemetry: appendObservationTelemetry(op, "residual_observation", "bridge", "failure",
        beforeTelemetry, source.readTelemetry?.() ?? null) };
    }
  }
  private async residualFrom(op: BridgeOperationRecord, source: BridgeRpcPort) {
    const m = op.intent.materialization, account = await source.account(m.sender, m.approvalAddress, m.request.fromToken);
    if (account.chainId !== m.request.fromChainId || account.rpcOrigin !== op.intent.sourceRpcOrigin ||
      account.owner !== m.sender || account.token !== m.request.fromToken || account.spender !== m.approvalAddress) bridgeFailure("APN_RPC_PROTOCOL", "residual_allowance_identity");
    return { amountAtomic: account.allowanceAtomic, block: account.block, rpcOrigin: account.rpcOrigin };
  }
  private async finish(op: BridgeOperationRecord, reason = "delivery_correlated"): Promise<BridgeOperationRecord> {
    const residual = await this.residualObservation(op);
    if (!residual.ok) return await this.save(op, { state: "unknown_finality", observationTelemetry: residual.observationTelemetry,
      failure: { reason: "residual_allowance_unavailable", residualAllowance: null } });
    return await this.save(op, { state: "completed", observationTelemetry: residual.observationTelemetry,
      failure: { reason, residualAllowance: residual.value } });
  }
  private async finishDestinationFailure(op: BridgeOperationRecord, reason: "recovered_weth" | "below_floor" | "protocol_mismatch"): Promise<BridgeOperationRecord> {
    const residual = await this.residualObservation(op);
    return await this.save(op, { state: "destination_failed", observationTelemetry: residual.observationTelemetry,
      failure: residual.ok ? { reason, residualAllowance: residual.value, residualAllowanceStatus: "observed" } :
        { reason, residualAllowance: null, residualAllowanceStatus: "unavailable" } });
  }
  private async destinationCandidate(op: BridgeOperationRecord, hash: Hex, destination: BridgeRpcPort): Promise<BridgeVerifiedDestinationProof> {
    const request = op.intent.materialization.request;
    const proveNativeDelta = bridgeProviderBoundNativeDestination(request);
    const bnb = op.intent.decoded.composite !== undefined;
    let canonical = null;
    let canonicalDeployment: BridgeDeploymentIdentity | null = null;
    const observe = async (transactionHash: Hex, nativeDelivery?: Parameters<BridgeRpcPort["observe"]>[2]) =>
      destination.observeDestination === undefined
        ? await destination.observe(transactionHash, undefined, nativeDelivery)
        : await destination.observeDestination(transactionHash, nativeDelivery);
    if (bnb) {
      canonical = requireSafeDestination(await observe(hash));
      canonicalDeployment = await this.historicalDeployment(op, destination, canonical.transaction, op.intent.destinationDeployment);
      try { validateBnbFilledRelay(op.sourceProof!, op.intent.materialization, op.intent.decoded, canonical.receipt); }
      catch { throw new BnbProtocolMismatch(); }
    }
    const found = requireSafeDestination(await observe(hash, proveNativeDelta ? { recipient: request.recipient,
      from: bnb ? BNB_COMPOSITE.executor : bridgeProtocolEmitter(request.toChainId, "across", request.toToken),
      ...(bnb ? { minimumAmountAtomic: op.intent.decoded.minimumOutputAtomic,
        composite: { message: op.intent.decoded.protocol.kind === "across" ? op.intent.decoded.protocol.message : "0x", call: op.intent.decoded.composite! } } : { amountAtomic: op.sourceProof!.correlation.kind === "across"
        ? op.sourceProof!.correlation.outputAmountAtomic : op.intent.decoded.minimumOutputAtomic }) } : undefined));
    if (canonical !== null && (!bridgeSame(proofIdentity(canonical.transaction), proofIdentity(found.transaction)) ||
      !bridgeSame(canonical.receipt.logs, found.receipt.logs))) bridgeFailure("APN_RPC_PROTOCOL", "destination_trace_rebind");
    const observedDeployment = canonicalDeployment ??
      await this.historicalDeployment(op, destination, found.transaction, op.intent.destinationDeployment);
    let proof;
    const nativeStargate = op.intent.decoded.protocol.kind === "stargateV2" &&
      op.intent.decoded.protocol.assetId === 13;
    const pool = nativeStargate ? bridgeDeployment(8453, 1, "stargateV2", request.toToken) : null;
    const poolCodeHash = pool?.code.find((row) => row.address === pool.protocolEmitter)?.codeHash;
    if (nativeStargate && poolCodeHash === undefined) bridgeFailure("APN_RPC_PROTOCOL", "stargate_native_destination_pin");
    try { proof = bridgeDestinationProof(op.sourceProof!, op.intent.materialization, op.intent.decoded, found.receipt,
      nativeStargate ? { pool: pool!.protocolEmitter, frozenDeployment: op.intent.destinationDeployment,
        observedDeployment, frozenPoolCodeHash: poolCodeHash!, observedPoolCodeHash: poolCodeHash! } : undefined); }
    catch (error) { if (bnb) throw new BnbProtocolMismatch(); throw error; }
    const safeBlock = found.transaction.safeBlock;
    if (safeBlock === null) throw new DestinationPending();
    return { ...proof, safeBlock, rpcOrigin: destination.origin,
      transactionProofHash: hashObject(proofIdentity(found.transaction)) };
  }
  private async waiting(op: BridgeOperationRecord, observationTelemetry?: BridgeMutable["observationTelemetry"]): Promise<BridgeOperationRecord> {
    const provider = op.providerObservation?.status;
    const exceptional = provider !== undefined && !["not_found", "pending", "completed_observed"].includes(provider);
    return await this.save(op, { state: exceptional ? "unknown_finality" : "destination_pending", ...(observationTelemetry === undefined ? {} : { observationTelemetry }),
      failure: exceptional ? { reason: `provider_${provider}_unproved`, residualAllowance: null } : null });
  }
  private async historicalDeployment(op: BridgeOperationRecord, rpc: BridgeRpcPort,
    proof: BridgeTransactionProof | BridgeDestinationTransactionProof, frozen: BridgeDeploymentIdentity): Promise<BridgeDeploymentIdentity> {
    if (rpc.origin !== frozen.rpcOrigin || proof.rpcOrigin !== frozen.rpcOrigin || proof.chainId !== frozen.chainId) bridgeFailure("APN_RPC_CONFIG", "observation_RPC_identity");
    const current = await rpc.deployment(op.intent.materialization.tool, frozen.peerChainId,
      frozen.chainId === op.intent.materialization.request.fromChainId ? op.intent.materialization.request.fromToken : op.intent.materialization.request.toToken,
      proof.block, true);
    if (current.contractHash !== frozen.contractHash) bridgeFailure("APN_PROVIDER_PROTOCOL", "historical_deployment_contract_hash");
    if (current.codeHash !== frozen.codeHash) bridgeFailure("APN_PROVIDER_PROTOCOL", "historical_deployment_code_hash");
    if (current.configurationHash !== frozen.configurationHash) bridgeFailure("APN_PROVIDER_PROTOCOL", "historical_deployment_configuration_hash");
    if (!bridgeSame(current.block, proof.block)) bridgeFailure("APN_PROVIDER_PROTOCOL", "historical_deployment_block");
    return current;
  }
}
function sourceProofDiagnostic(error: unknown): ApnError {
  const code = error instanceof ApnError ? error.code : "APN_RPC_PROTOCOL";
  return new ApnError(code, "Bridge validation failed: source_proof.", { reason: "source_proof" });
}
function appendObservationTelemetry(op: BridgeOperationRecord, stage: "source_observation" | "destination_observation" | "residual_observation",
  effectRole: "approval" | "bridge", outcome: "success" | "missing" | "failure",
  before: RpcReadTelemetry | null, after: RpcReadTelemetry | null) {
  const existing = op.observationTelemetry ?? [];
  if (after === null) return existing;
  const prior = before ?? zeroTelemetry(after.deadline), deltaRecord = (current: Readonly<Record<string, number>>, previous: Readonly<Record<string, number>>) =>
    Object.fromEntries(Object.keys(current).sort().map((key) => [key, Math.max(0, (current[key] ?? 0) - (previous[key] ?? 0))]));
  const roleAttempts = { primary: Math.max(0, after.attemptsByEndpointRole.primary - prior.attemptsByEndpointRole.primary),
    receipt: Math.max(0, after.attemptsByEndpointRole.receipt - prior.attemptsByEndpointRole.receipt),
    archive: Math.max(0, after.attemptsByEndpointRole.archive - prior.attemptsByEndpointRole.archive) };
  return [...existing, { schemaVersion: "apn.bridge-observation-telemetry.v1" as const, stage, effectRole, outcome,
    physicalRequests: roleAttempts.primary + roleAttempts.receipt + roleAttempts.archive,
    httpAttempts: Math.max(0, after.httpAttempts - prior.httpAttempts),
    logicalRpcItems: Math.max(0, after.logicalItems - prior.logicalItems), batchCount: Math.max(0, after.batchCount - prior.batchCount),
    maxBatchSize: invocationMaxBatchSize(after.attemptsByBatchSize, prior.attemptsByBatchSize),
    budgetRejectedBeforeTransport: Math.max(0, after.budgetRejectedBeforeTransport - prior.budgetRejectedBeforeTransport),
    attemptsByEndpointRole: roleAttempts,
    attemptsByMethodClass: deltaRecord(after.attemptsByMethodClass, prior.attemptsByMethodClass) }];
}
function zeroTelemetry(deadline: number): RpcReadTelemetry {
  return { logicalItems: 0, httpRequests: 0, httpAttempts: 0, batchCount: 0, batchItemsByMethod: {}, dedupHits: 0, cacheHits: 0,
    singleflightHits: 0, endpointIdentities: [], remainingLogicalItems: 0, remainingHttpRequests: 0, remainingHttpAttempts: 0, deadline,
    uniqueCalls: 0, totalAttempts: 0, perMethod: {}, remainingUniqueCalls: 0, attemptsByEndpointRole: { primary: 0, receipt: 0, archive: 0 },
    attemptsByMethodClass: {}, attemptsByBatchSize: {}, maxBatchSize: 0, budgetRejectedBeforeTransport: 0 };
}
function invocationMaxBatchSize(current: Readonly<Record<string, number>>, previous: Readonly<Record<string, number>>): number {
  return Object.keys(current).map(Number).filter((size) => Number.isSafeInteger(size) && size > 0 &&
    (current[String(size)] ?? 0) > (previous[String(size)] ?? 0)).reduce((maximum, size) => Math.max(maximum, size), 0);
}
function observationFailure(effectRole: "approval" | "bridge", error: unknown, fallbackCode: ErrorCode | null = null) {
  return { reason: "source_observation_unavailable", residualAllowance: null,
    observationRpc: observationRpcFailure("source", effectRole, error, fallbackCode) };
}
function destinationObservationFailure(reason: string, error: unknown) {
  return { reason, residualAllowance: null, ...(error instanceof ApnError
    ? { observationRpc: observationRpcFailure("destination", "bridge", error) } : {}) };
}
class BnbProtocolMismatch extends Error {}
class DestinationPending extends Error {}
export function replaceEffect(op: BridgeOperationRecord, effect: BridgeEffect): readonly BridgeEffect[] {
  return op.effects.map((e) => e.role === effect.role ? effect : e);
}
function proofIdentity(proof: BridgeTransactionProof | BridgeDestinationTransactionProof) { return { ...proof, safeBlock: null }; }
function reusableProviderObservation(op: BridgeOperationRecord): boolean {
  const observation = op.providerObservation, bridge = op.effects.at(-1);
  if (observation?.status !== "completed_observed") return false;
  if (op.sourceProof === null || bridge?.role !== "bridge" || bridge.phase !== "safe_success" ||
    bridge.transactionHash !== op.sourceProof.transactionHash || observation.responseHash === null ||
    !isEvmTransactionHash(observation.destinationTransactionHash)) bridgeFailure("APN_STATE_CORRUPT", "durable_bridge_provider_binding");
  return op.failure?.observationRpc?.reason !== "destination_transaction_reverted";
}
function requireSafeDestination<T extends { readonly transaction: { readonly safeBlock: unknown | null; readonly status: "success" | "reverted" } }>(observation: T | null): T {
  if (observation === null || observation.transaction.safeBlock === null) throw new DestinationPending();
  if (observation.transaction.status === "reverted") bridgeFailure("APN_RPC_PROTOCOL", "destination_transaction_reverted", {
    rpcMethod: "eth_getTransactionReceipt",
  });
  return observation;
}
