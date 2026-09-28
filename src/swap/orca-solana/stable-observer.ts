import { address, getBase58Encoder, getBase64EncodedWireTransaction, getTransactionDecoder } from "@solana/kit";
import { canonicalJson, sha256 } from "../../canonical.js";
import { validateChainAccount } from "../../chain-account-store.js";
import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { SolanaRpc, assertSolanaNetwork, rpcArray, rpcRecord } from "../../solana/rpc.js";
import type { AssetUsageReservation } from "../../asset-usage-ledger.js";
import { GuardedSwapService } from "../service.js";
import type { SwapOperationRecord } from "../model.js";
import { loadOrcaStableSendClaim } from "./stable-effect-runtime.js";
import { OrcaStableExecutionBindingStore, verifyOrcaStableSignedEffect } from "./stable-execution-journal.js";
import { OrcaStableFinalizedObservationStore, sealOrcaStableFinalizedObservation,
  type OrcaStableFinalizedObservation } from "./stable-finalized-proof.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { verifyOrcaStableFinalizedReceipt } from "./stable-receipt.js";

/** Internal observe-only route. Every entry reloads durable state under the sender's operation lock. */
export class OrcaStableFinalizedObserver {
  private readonly observations: OrcaStableFinalizedObservationStore;
  constructor(private readonly service: GuardedSwapService,
    private readonly materials: SavedOrcaStableMaterialStore,
    private readonly bindings: OrcaStableExecutionBindingStore,
    private readonly custody: Pick<ChainWalletStoragePort, "account">,
    private readonly rpc: SolanaRpc, private readonly clock: () => Date = () => new Date()) {
    this.observations = new OrcaStableFinalizedObservationStore(service.operations.root);
  }

  async observe(operationId: string): Promise<SwapOperationRecord> {
    return await this.service.operations.withLocks([`orca-stable-operation:${operationId}`], async () => {
      let operation = await this.service.operations.loadAny(operationId);
      if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
      if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST ||
          operation.submissionMarker === null || operation.usageLease === null ||
          !["submitting", "submitted", "unknown_finality", "finalized", "failed_confirmed_revert"].includes(operation.state))
        blocked("Stable operation has no claimed observation boundary.");
      const material = await this.materials.load(operationId, operation);
      if (material === null) corrupt("Stable observation material is missing.");
      const binding = await this.bindings.load(operation, material);
      if (binding === null || binding.submissionMarkerHash !== operation.submissionMarker.markerHash)
        corrupt("Stable observation binding is missing.");
      if (this.rpc.originHash !== binding.sourceBinding.rpcOriginHash)
        blocked("Stable observation RPC source changed.");
      const accountRaw = await this.custody.account(operation.quote.profile, "solana");
      if (accountRaw === null) corrupt("Stable observation custody is missing.");
      const account = validateChainAccount(accountRaw);
      if (account.profile !== operation.quote.profile || account.address !== operation.quote.account ||
          account.rail !== "solana" || account.network !== "mainnet" || account.provider !== "local" ||
          account.custody !== "local_software") corrupt("Stable observation custody changed.");
      const claim = await loadOrcaStableSendClaim(this.service.operations.root, operation);
      if (claim === null || claim.bindingHash !== binding.bindingHash ||
          claim.accountIdentityHash !== account.identityHash) corrupt("Stable send claim changed.");
      // The immutable execution binding has the exact unsigned message; the durable claim has its
      // owner signature and signed-wire hash. Reconstruct and verify the signed wire from these
      // public records. Observation must never decrypt the wallet or open its signing seed.
      let rawPayload: string;
      try {
        const unsigned = getTransactionDecoder().decode(Buffer.from(binding.preview.unsignedPayload, "base64"));
        const signed = { ...unsigned,
          signatures: { [address(binding.preview.owner)]: getBase58Encoder().encode(claim.signature) } } as typeof unsigned;
        rawPayload = getBase64EncodedWireTransaction(signed);
      } catch { corrupt("Stable claimed signature cannot reconstruct the signed message."); }
      const effect = { operationId, fingerprint: binding.bindingHash, transactionId: claim.signature,
        rawPayload, rawPayloadHash: sha256(rawPayload) };
      if (claim.rawPayloadHash !== effect.rawPayloadHash) corrupt("Stable send claim changed.");
      await verifyOrcaStableSignedEffect(effect, binding);
      const identity = { account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
        asset: { kind: "token" as const, identifier: operation.quote.sourceAsset.identifier! } };
      const live = await this.service.usage.load(identity, operation.usageLease.reservationId);
      if (live === null || !sameLeaseIdentity(live, operation.usageLease)) corrupt("Stable principal lease changed.");
      const saved = await this.observations.load(operation);
      if (saved !== null) {
        if (saved.materialDigest !== material.materialDigest || saved.bindingHash !== binding.bindingHash ||
            saved.claimHash !== claim.claimHash || saved.accountIdentityHash !== account.identityHash ||
            saved.proof.transactionHash !== effect.transactionId ||
            (!["finalized", "failed_confirmed_revert"].includes(operation.state) &&
              saved.reservedLeaseDigest !== operation.usageLease.reservationDigest) ||
            (operation.receiptProof !== null && canonicalJson(operation.receiptProof) !== canonicalJson(saved.proof)))
          corrupt("Stable finalized observation binding changed.");
        if (!["finalized", "failed_confirmed_revert"].includes(operation.state) &&
            !await this.verifyRpcSource()) return operation;
        return await this.replay(operation, live, saved);
      }
      if (["finalized", "failed_confirmed_revert"].includes(operation.state) ||
          ["finalized", "failed_confirmed_revert", "failed_before_effect", "released_unsubmitted"].includes(live.state))
        corrupt("Stable terminal lease has no verified observation.");
      if (operation.receiptProof !== null) blocked("Stable operation has another receipt proof.");
      // The claim may have been written immediately before a process crash. Record possible-send
      // before reading RPC; this never reopens signing or transport and keeps principal reserved.
      if (operation.state === "submitting") {
        operation = await this.service.recordPossibleSend(operation, "unknown_finality", this.now(operation, live, claim.claimedAt));
      } else if (operation.usageLease.state !== live.state ||
          canonicalJson(operation.usageLease) !== canonicalJson(live)) corrupt("Stable principal lease drifted.");
      if (!await this.verifyRpcSource()) return operation;
      if (this.rpc.budget!.remainingPhysicalRequests < 1) return operation;
      let statuses: unknown, transaction: unknown = null;
      try {
        statuses = await this.rpc.call("getSignatureStatuses", [[claim.signature], { searchTransactionHistory: true }]);
      } catch { return operation; }
      const rows = rpcArray(rpcRecord(statuses).value, 1);
      if (rows.length === 1 && rows[0] !== null && rpcRecord(rows[0]).confirmationStatus === "finalized") {
        if (this.rpc.budget!.remainingPhysicalRequests < 1) return operation;
        try {
          transaction = await this.rpc.call("getTransaction", [claim.signature,
            { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
        } catch { return operation; }
      }
      const observedAt = this.now(operation, operation.usageLease!, claim.claimedAt);
      const result = await verifyOrcaStableFinalizedReceipt({ operation, material, executionPreview: binding.preview,
        signature: claim.signature,
        signatureStatuses: statuses, transaction, observedAt });
      if (result === null) return operation;
      const observation = sealOrcaStableFinalizedObservation(operation, {
        materialDigest: material.materialDigest, bindingHash: binding.bindingHash, claimHash: claim.claimHash,
        accountIdentityHash: account.identityHash }, result.outcome, result.proof);
      await this.observations.save(operation, observation);
      return await this.replay(operation, operation.usageLease!, observation);
    });
  }

  private async replay(operation: SwapOperationRecord, live: AssetUsageReservation,
    saved: OrcaStableFinalizedObservation): Promise<SwapOperationRecord> {
    const terminal = saved.outcome === "succeeded" ? "finalized" : "failed_confirmed_revert";
    if (operation.state === terminal) {
      if (live.state !== terminal || canonicalJson(live) !== canonicalJson(operation.usageLease) ||
          operation.receiptProof === null || canonicalJson(operation.receiptProof) !== canonicalJson(saved.proof) ||
          live.outcomeDigest !== saved.proof.receiptHash) corrupt("Stable terminal observation changed.");
      return operation;
    }
    if (["finalized", "failed_confirmed_revert"].includes(operation.state) ||
        (operation.receiptProof !== null && canonicalJson(operation.receiptProof) !== canonicalJson(saved.proof)))
      corrupt("Stable operation conflicts with the saved observation.");
    if (live.state === terminal) {
      if (live.outcomeDigest !== saved.proof.receiptHash) corrupt("Stable terminal lease outcome changed.");
      const now = this.now(operation, live, saved.proof.observedAt);
      return await this.service.operations.transition(operation.ownerProfileHash, operation.operationId,
        operation.integrityHash, terminal, { usageLease: live, receiptProof: saved.proof,
          ...(terminal === "failed_confirmed_revert" ? { failureProofHash: saved.proof.receiptHash } : {}) }, now);
    }
    if (!["reserved", "submitted", "unknown_finality"].includes(live.state)) corrupt("Stable principal lease has an invalid phase.");
    if (operation.state === "submitting") {
      operation = await this.service.recordPossibleSend(operation, "unknown_finality", this.now(operation, live, saved.proof.observedAt));
    } else if (canonicalJson(operation.usageLease) !== canonicalJson(live)) corrupt("Stable principal lease drifted.");
    const now = this.now(operation, operation.usageLease!, saved.proof.observedAt);
    return terminal === "finalized" ? await this.service.finalize(operation, now, saved.proof)
      : await this.service.failConfirmedRevert(operation, now, saved.proof);
  }

  private async verifyRpcSource(): Promise<boolean> {
    if (this.rpc.budget === undefined || this.rpc.budget.remainingPhysicalRequests < 1 ||
        this.rpc.budget.minimumIntervalMs < 750 || !this.rpc.hasPersistentPacer)
      blocked("Stable observation requires budgeted, paced Solana RPC.");
    try { await assertSolanaNetwork(this.rpc); } catch (error) {
      if (error instanceof ApnError && error.code === "APN_CHAIN_MISMATCH") throw error;
      return false;
    }
    return true;
  }

  private now(operation: SwapOperationRecord, lease: AssetUsageReservation, observedAt?: string): Date {
    const current = this.clock();
    if (!(current instanceof Date) || !Number.isFinite(current.getTime()))
      throw new ApnError("APN_INVALID_INPUT", "Stable observation clock is invalid.");
    return new Date(Math.max(current.getTime(), Date.parse(operation.updatedAt), Date.parse(lease.updatedAt),
      observedAt === undefined ? 0 : Date.parse(observedAt)));
  }
}

function sameLeaseIdentity(a: AssetUsageReservation, b: AssetUsageReservation): boolean {
  return a.reservationId === b.reservationId && a.account === b.account && a.chain === b.chain &&
    canonicalJson(a.asset) === canonicalJson(b.asset) && a.rail === b.rail &&
    a.idempotencyHash === b.idempotencyHash && a.amountAtomic === b.amountAtomic &&
    a.policyDigest === b.policyDigest && a.registryVersion === b.registryVersion && a.reservedAt === b.reservedAt;
}
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "orca_stable_observe_only" }); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
