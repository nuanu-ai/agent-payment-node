import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import type { ClockPort, X402RpcPort } from "./ports.js";
import { matchingTransfer, sameRpcOrigin, validX402Head } from "./x402-rpc-scan.js";
import {
  appendX402Transition,
  sealX402Operation,
  x402OperationBindingHash,
  type Erc7710SettlementEvidence,
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
      operation.settlementEvidence !== undefined || operation.transactionHint === undefined ||
      operation.settlementResponseObservation === undefined || operation.signatureHash === undefined ||
      operation.paymentContextHash === undefined || operation.delegatedMaterial === undefined) return operation;
    const chain = await this.rpc.assertBaseChain();
    if (sha256(chain.rpcOrigin) !== operation.delegatedMaterial.rpcOriginHash) return operation;
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
}
