import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import type { ClockPort, X402RpcPort } from "./ports.js";
import { matchingTransfer, sameRpcOrigin, validX402Head } from "./x402-rpc-scan.js";
import {
  appendX402Transition,
  sealX402Operation,
  x402OperationBindingHash,
  type Erc7710SettlementEvidence,
  type Erc7710UnusedExpiryEvidence,
  type X402OperationRecord,
} from "./x402-state-integrity.js";

export interface Erc7710ReconciliationStore {
  persist(operation: X402OperationRecord): Promise<void>;
}

export class X402Erc7710RpcReconciler {
  constructor(
    private readonly rpc: X402RpcPort,
    private readonly clock: ClockPort,
    private readonly store: Erc7710ReconciliationStore,
  ) {}

  async reconcile(operation: X402OperationRecord): Promise<X402OperationRecord> {
    if (operation.selectedOffer.resolved.assetTransferMethod !== "erc7710" ||
      operation.settlementEvidence !== undefined || operation.unusedExpiryEvidence !== undefined ||
      operation.delegatedMaterial === undefined) return operation;
    const chain = await this.rpc.assertBaseChain();
    if (sha256(chain.rpcOrigin) !== operation.delegatedMaterial.rpcOriginHash) return operation;
    if (this.canProveExpiredUnused(operation)) {
      return await this.reconcileExpiredUnused(operation, chain.rpcOrigin);
    }
    if (operation.transactionHint === undefined || operation.settlementResponseObservation === undefined ||
      operation.signatureHash === undefined || operation.paymentContextHash === undefined) return operation;
    const safe = await this.rpc.getX402Head("safe");
    if (!validX402Head(safe) || !sameRpcOrigin(safe.rpcOrigin, chain.rpcOrigin)) return operation;
    let safeBlock;
    try { safeBlock = await this.rpc.getX402Block(safe.number); }
    catch { return operation; }
    if (safeBlock.number !== safe.number || safeBlock.hash !== safe.hash || safeBlock.timestamp !== safe.timestamp ||
      !sameRpcOrigin(safeBlock.rpcOrigin, chain.rpcOrigin)) return operation;
    let receipt;
    try { receipt = await this.rpc.getX402Receipt(operation.transactionHint.transactionHash); }
    catch { return operation; }
    if (receipt === null || receipt.status !== "success" ||
      receipt.transactionHash !== operation.transactionHint.transactionHash ||
      BigInt(receipt.blockNumber) > BigInt(safe.number) || !sameRpcOrigin(receipt.rpcOrigin, chain.rpcOrigin)) return operation;
    let transactionBlock;
    try { transactionBlock = await this.rpc.getX402Block(receipt.blockNumber); }
    catch { return operation; }
    if (transactionBlock.number !== receipt.blockNumber || transactionBlock.hash !== receipt.blockHash ||
      !sameRpcOrigin(transactionBlock.rpcOrigin, chain.rpcOrigin)) return operation;
    const transfers = receipt.logs.filter((log) => matchingTransfer(log, operation));
    if (transfers.length !== 1 || transfers[0] === undefined) return operation;
    const transfer = transfers[0];
    const methodBinding = {
      paymentResponseHash: operation.settlementResponseObservation.settlementResponseHash,
      operationBindingHash: x402OperationBindingHash(operation),
      offerHash: operation.selectedOffer.offerHash,
      method: "erc7710" as const,
      delegationManager: operation.delegatedMaterial.delegationManager,
      delegator: operation.wallet,
      childHash: operation.signatureHash,
      permissionContextHash: operation.paymentContextHash,
    };
    const body = {
      schemaVersion: "apn.x402.erc7710-settlement-evidence.v1" as const,
      network: CHAIN_CAIP2,
      chainId: "8453" as const,
      token: BASE_USDC.toLowerCase() as `0x${string}`,
      transactionHash: operation.transactionHint.transactionHash,
      safeHead: { number: safe.number, hash: safe.hash, observedAt: safe.observedAt },
      transactionBlock: {
        number: transactionBlock.number,
        hash: transactionBlock.hash,
        timestamp: transactionBlock.timestamp,
      },
      receiptStatus: "1" as const,
      blockHashRechecked: true as const,
      transfer: {
        logIndex: transfer.logIndex,
        from: operation.wallet,
        to: operation.payee,
        value: operation.amountAtomic,
        blockNumber: transfer.blockNumber,
        blockHash: transfer.blockHash,
        transactionHash: transfer.transactionHash,
      },
      methodBinding,
      rpcOriginHash: sha256(chain.rpcOrigin),
    };
    const evidence: Erc7710SettlementEvidence = {
      ...body,
      evidenceHash: domainHash("apn.x402.erc7710-settlement-evidence.v1", canonicalJson(body)),
    };
    const at = this.clock.now().toISOString();
    const { integrityHash: _integrity, ...withoutIntegrity } = operation;
    const next = sealX402Operation({
      ...withoutIntegrity,
      settlementEvidence: evidence,
      updatedAt: at,
      transitions: appendX402Transition(operation.transitions, {
        at,
        state: operation.state,
        terminal: false,
        reason: operation.reason,
        proofClass: operation.proofClass,
      }),
    });
    await this.store.persist(next);
    return next;
  }

  private canProveExpiredUnused(operation: X402OperationRecord): boolean {
    return operation.state === "effect_unknown" && operation.transactionHint === undefined &&
      operation.settlementResponseObservation === undefined && operation.settlementEvidence === undefined &&
      operation.resultLink === undefined && operation.signatureHash !== undefined &&
      operation.paymentContextHash !== undefined &&
      operation.attempts.some((attempt) => attempt.purpose === "payment" && attempt.phase !== "pending");
  }

  private async reconcileExpiredUnused(
    operation: X402OperationRecord,
    rpcOrigin: string,
  ): Promise<X402OperationRecord> {
    const binding = operation.delegatedMaterial;
    if (binding === undefined) return operation;
    let finalized;
    try { finalized = await this.rpc.getX402Head("finalized"); }
    catch { return operation; }
    if (!validX402Head(finalized) || !sameRpcOrigin(finalized.rpcOrigin, rpcOrigin) ||
      BigInt(finalized.timestamp) < BigInt(binding.effectiveExpiryUnix) ||
      BigInt(finalized.number) < BigInt(operation.preparedBlock.number)) return operation;
    let canonicalFinalized;
    let startBlock;
    try {
      canonicalFinalized = await this.rpc.getX402Block(finalized.number);
      startBlock = await this.rpc.getX402Block(operation.preparedBlock.number);
    } catch { return operation; }
    if (!sameBlock(canonicalFinalized, finalized, rpcOrigin) ||
      startBlock.number !== operation.preparedBlock.number || startBlock.hash !== operation.preparedBlock.hash ||
      !sameRpcOrigin(startBlock.rpcOrigin, rpcOrigin) ||
      BigInt(startBlock.timestamp) >= BigInt(binding.effectiveExpiryUnix)) return operation;

    const expiryBlock = await this.firstExpiredBlock(
      startBlock.number,
      finalized.number,
      binding.effectiveExpiryUnix,
      rpcOrigin,
    );
    if (expiryBlock === null) return operation;
    const noExactTransfer = await this.scanExactTransfers(
      operation,
      startBlock.number,
      expiryBlock.number,
    );
    if (!noExactTransfer) return operation;

    let finalizedRecheck;
    let startRecheck;
    let expiryRecheck;
    try {
      finalizedRecheck = await this.rpc.getX402Head("finalized");
      startRecheck = await this.rpc.getX402Block(startBlock.number);
      expiryRecheck = await this.rpc.getX402Block(expiryBlock.number);
    } catch { return operation; }
    if (!sameHead(finalized, finalizedRecheck) || !sameBlock(startBlock, startRecheck, rpcOrigin) ||
      !sameBlock(expiryBlock, expiryRecheck, rpcOrigin)) return operation;

    const completedAt = this.clock.now().toISOString();
    const body = {
      schemaVersion: "apn.x402.erc7710-unused-expiry-evidence.v1" as const,
      network: CHAIN_CAIP2,
      chainId: "8453" as const,
      token: BASE_USDC.toLowerCase() as `0x${string}`,
      effectiveExpiryUnix: binding.effectiveExpiryUnix,
      searchStartBlock: {
        number: operation.preparedBlock.number,
        hash: operation.preparedBlock.hash,
        observedAt: operation.preparedBlock.observedAt,
      },
      expiryBlock: {
        number: expiryBlock.number,
        hash: expiryBlock.hash,
        timestamp: expiryBlock.timestamp,
        observedAt: expiryBlock.observedAt,
      },
      finalizedHead: {
        number: finalized.number,
        hash: finalized.hash,
        timestamp: finalized.timestamp,
        observedAt: finalized.observedAt,
      },
      scan: {
        fromBlock: operation.preparedBlock.number,
        toBlock: expiryBlock.number,
        matchingTransferCount: "0" as const,
        completedAt,
      },
      methodBinding: {
        operationBindingHash: x402OperationBindingHash(operation),
        offerHash: operation.selectedOffer.offerHash,
        method: "erc7710" as const,
        delegationManager: binding.delegationManager,
        delegator: operation.wallet,
        childHash: operation.signatureHash as string,
        permissionContextHash: operation.paymentContextHash as string,
      },
      rpcOriginHash: sha256(rpcOrigin),
    };
    const evidence: Erc7710UnusedExpiryEvidence = {
      ...body,
      evidenceHash: domainHash("apn.x402.erc7710-unused-expiry-evidence.v1", canonicalJson(body)),
    };
    const { integrityHash: _integrity, ...withoutIntegrity } = operation;
    const next = sealX402Operation({
      ...withoutIntegrity,
      unusedExpiryEvidence: evidence,
      updatedAt: completedAt,
      transitions: appendX402Transition(operation.transitions, {
        at: completedAt,
        state: operation.state,
        terminal: false,
        reason: operation.reason,
        proofClass: operation.proofClass,
      }),
    });
    await this.store.persist(next);
    return next;
  }

  private async firstExpiredBlock(
    startNumber: string,
    finalizedNumber: string,
    expiryUnix: string,
    rpcOrigin: string,
  ): Promise<Awaited<ReturnType<X402RpcPort["getX402Block"]>> | null> {
    let low = BigInt(startNumber);
    let high = BigInt(finalizedNumber);
    while (low + 1n < high) {
      const middle = (low + high) / 2n;
      let block;
      try { block = await this.rpc.getX402Block(middle.toString()); }
      catch { return null; }
      if (block.number !== middle.toString() || !sameRpcOrigin(block.rpcOrigin, rpcOrigin)) return null;
      if (BigInt(block.timestamp) >= BigInt(expiryUnix)) high = middle;
      else low = middle;
    }
    let block;
    try { block = await this.rpc.getX402Block(high.toString()); }
    catch { return null; }
    if (block.number !== high.toString() || !sameRpcOrigin(block.rpcOrigin, rpcOrigin) ||
      BigInt(block.timestamp) < BigInt(expiryUnix)) return null;
    return block;
  }

  private async scanExactTransfers(
    operation: X402OperationRecord,
    startNumber: string,
    endNumber: string,
  ): Promise<boolean> {
    let from = BigInt(startNumber);
    const end = BigInt(endNumber);
    let chunkSize = 2048n;
    while (from <= end) {
      const to = from + chunkSize - 1n < end ? from + chunkSize - 1n : end;
      let result;
      try {
        result = await this.rpc.getX402TransferLogs({
          from: operation.wallet,
          fromBlock: from.toString(),
          toBlock: to.toString(),
        });
      } catch { return false; }
      if (result.kind === "range_unavailable" && chunkSize > 1n) {
        chunkSize = chunkSize / 2n;
        continue;
      }
      if (result.kind !== "complete") return false;
      if (result.logs.some((log) => matchingTransfer(log, operation))) return false;
      from = to + 1n;
    }
    return true;
  }
}

function sameHead(
  left: { readonly number: string; readonly hash: string; readonly timestamp: string; readonly rpcOrigin: string },
  right: { readonly number: string; readonly hash: string; readonly timestamp: string; readonly rpcOrigin: string },
): boolean {
  return left.number === right.number && left.hash === right.hash && left.timestamp === right.timestamp &&
    left.rpcOrigin === right.rpcOrigin;
}

function sameBlock(
  left: { readonly number: string; readonly hash: string; readonly timestamp: string; readonly rpcOrigin: string },
  right: { readonly number: string; readonly hash: string; readonly timestamp: string; readonly rpcOrigin: string },
  rpcOrigin: string,
): boolean {
  return left.number === right.number && left.hash === right.hash && left.timestamp === right.timestamp &&
    left.rpcOrigin === rpcOrigin && right.rpcOrigin === rpcOrigin;
}
