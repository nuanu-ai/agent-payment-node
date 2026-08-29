import { canonicalJson, domainHash } from "./canonical.js";
import { BASE_USDC } from "./constants.js";
import type { ClockPort, X402RpcHead, X402RpcLog, X402RpcPort } from "./ports.js";
import {
  x402TransactionHintSourceBindingHash,
  type AuthorizationUsedCandidate,
  type AuthorizationUsedScan,
  type X402OperationRecord,
  type X402State,
} from "./x402-state-integrity.js";

const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type ScanAdditions = Partial<Pick<X402OperationRecord,
  "authorizationUsedScan" | "transactionHint" | "settlementEvidence" | "unusedExpiryEvidence"
>>;

type ScanPersist = (
  operation: X402OperationRecord,
  additions: ScanAdditions,
  stateOverride?: X402State,
  clearLogDerivedEvidence?: boolean,
) => Promise<X402OperationRecord>;

export interface X402ScanOutcome {
  readonly operation: X402OperationRecord;
  readonly reorg: boolean;
  readonly unavailable: boolean;
  readonly malformed: boolean;
  readonly read: boolean;
}

export class X402RpcScanner {
  constructor(
    private readonly rpc: X402RpcPort,
    private readonly clock: ClockPort,
    private readonly persist: ScanPersist,
  ) {}

  async scanOneChunk(
    input: X402OperationRecord,
    observedSafe: X402RpcHead,
    rpcOrigin: string,
  ): Promise<X402ScanOutcome> {
    let operation = input;
    let scan = operation.authorizationUsedScan;
    if (scan === undefined) {
      if (BigInt(observedSafe.number) < BigInt(operation.preparedBlock.number)) return malformed(operation, false);
      scan = sealScan({
        schemaVersion: "apn.x402.authorization-used-scan.v1",
        searchStartBlock: operation.preparedBlock.number,
        nextFromBlock: operation.preparedBlock.number,
        targetSafeHead: { number: observedSafe.number, hash: observedSafe.hash, observedAt: observedSafe.observedAt },
        candidates: [],
        status: "active",
        updatedAt: this.clock.now().toISOString(),
      });
      operation = await this.persist(operation, { authorizationUsedScan: scan });
    }
    const anchored = await this.validateScanAnchor(operation, scan, rpcOrigin);
    operation = anchored.operation;
    if (anchored.reorg || anchored.malformed) {
      return { operation, reorg: anchored.reorg, unavailable: false, malformed: anchored.malformed, read: false };
    }
    scan = operation.authorizationUsedScan as AuthorizationUsedScan;
    if (scan.status === "complete") {
      const targetNumber = BigInt(scan.targetSafeHead.number);
      const observedNumber = BigInt(observedSafe.number);
      const postExposureExtension = operation.state === "effect_unknown" &&
        operation.attempts.some((attempt) => attempt.purpose === "payment");
      const preSendReorgExtension = operation.state === "effect_unknown" && operation.attempts.length === 0 &&
        operation.transitions.at(-2)?.state === "effect_unknown" && operation.transitions.at(-1)?.state === "effect_unknown";
      const preSendExtension = operation.state === "authorized_not_sent" &&
        !operation.attempts.some((attempt) => attempt.purpose === "payment");
      const extendable = (postExposureExtension || preSendReorgExtension || preSendExtension) && scan.candidates.length === 0 &&
        operation.transactionHint === undefined && operation.settlementEvidence === undefined && operation.resultLink === undefined;
      if (!extendable || observedNumber === targetNumber) return unchanged(operation);
      if (observedNumber < targetNumber) return malformed(operation, false);
      let extendedTarget;
      try { extendedTarget = await this.rpc.getX402Block(observedSafe.number); }
      catch { return malformed(operation, false); }
      if (
        extendedTarget.number !== observedSafe.number || extendedTarget.hash !== observedSafe.hash ||
        extendedTarget.timestamp !== observedSafe.timestamp || !sameRpcOrigin(extendedTarget.rpcOrigin, rpcOrigin)
      ) return malformed(operation, false);
      const active = sealScan({
        ...withoutEvidenceHash(scan),
        targetSafeHead: { number: observedSafe.number, hash: observedSafe.hash, observedAt: observedSafe.observedAt },
        status: "active",
        updatedAt: this.clock.now().toISOString(),
      });
      operation = await this.persist(operation, { authorizationUsedScan: active });
      scan = operation.authorizationUsedScan as AuthorizationUsedScan;
    } else if (scan.status === "ambiguous") return unchanged(operation);
    if (scan.status === "unavailable") {
      const active = sealScan({ ...withoutEvidenceHash(scan), status: "active", updatedAt: this.clock.now().toISOString() });
      operation = await this.persist(operation, { authorizationUsedScan: active });
      scan = operation.authorizationUsedScan as AuthorizationUsedScan;
    }

    const from = BigInt(scan.nextFromBlock);
    const head = BigInt(scan.targetSafeHead.number);
    if (from > head) return malformed(operation, false);
    const to = from + 2047n < head ? from + 2047n : head;
    let result;
    try {
      result = await this.rpc.getX402AuthorizationUsedLogs({
        authorizer: operation.wallet,
        nonce: operation.authorization.nonce,
        fromBlock: from.toString(),
        toBlock: to.toString(),
      });
    } catch { return malformed(operation, true); }
    if (result.kind !== "complete") {
      const commitAnchor = await this.validateScanAnchor(operation, scan, rpcOrigin);
      operation = commitAnchor.operation;
      if (commitAnchor.reorg || commitAnchor.malformed) {
        return { operation, reorg: commitAnchor.reorg, unavailable: false, malformed: commitAnchor.malformed, read: true };
      }
      scan = operation.authorizationUsedScan as AuthorizationUsedScan;
      const unavailable = sealScan({
        ...withoutEvidenceHash(scan),
        status: "unavailable",
        unavailableReason: result.kind,
        updatedAt: this.clock.now().toISOString(),
      });
      operation = await this.persist(operation, { authorizationUsedScan: unavailable });
      return { operation, reorg: false, unavailable: true, malformed: false, read: true };
    }

    const candidates = new Map(scan.candidates.map((candidate) => [candidateKey(candidate), candidate]));
    try {
      for (const log of result.logs) {
        if (!matchingAuthorizationUsed(log, operation) || BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to) {
          return malformed(operation, true);
        }
        const candidate = candidateFromLog(log, operation);
        const key = candidateKey(candidate);
        if (!candidates.has(key) && candidates.size < 2) candidates.set(key, candidate);
      }
    } catch { return malformed(operation, true); }
    let toBlock;
    try { toBlock = await this.rpc.getX402Block(to.toString()); }
    catch { return malformed(operation, true); }
    const finalAnchor = await this.validateScanAnchor(operation, scan, rpcOrigin);
    operation = finalAnchor.operation;
    if (finalAnchor.reorg || finalAnchor.malformed) {
      return { operation, reorg: finalAnchor.reorg, unavailable: false, malformed: finalAnchor.malformed, read: true };
    }
    scan = operation.authorizationUsedScan as AuthorizationUsedScan;
    if (to === head && toBlock.hash !== scan.targetSafeHead.hash) return malformed(operation, true);

    const candidateList = [...candidates.values()];
    const complete = to === head;
    const status: AuthorizationUsedScan["status"] = candidateList.length > 1 ? "ambiguous" : complete ? "complete" : "active";
    const updated = sealScan({
      schemaVersion: "apn.x402.authorization-used-scan.v1",
      searchStartBlock: scan.searchStartBlock,
      nextFromBlock: (to + 1n).toString(),
      targetSafeHead: scan.targetSafeHead,
      lastCompletedChunk: { fromBlock: from.toString(), toBlock: to.toString(), toBlockHash: toBlock.hash },
      candidates: candidateList,
      status,
      updatedAt: this.clock.now().toISOString(),
    });
    const unique = status === "complete" && candidateList.length === 1 ? candidateList[0] : undefined;
    operation = await this.persist(operation, {
      authorizationUsedScan: updated,
      ...(unique === undefined ? {} : {
        transactionHint: {
          transactionHash: unique.transactionHash,
          source: "authorization_used_log" as const,
          sourceBindingHash: x402TransactionHintSourceBindingHash("authorization_used_log", updated.evidenceHash),
          observedAt: updated.updatedAt,
        },
      }),
    }, operation.state === "authorized_not_sent" && candidateList.length > 0 ? "effect_unknown" : undefined);
    return { operation, reorg: false, unavailable: false, malformed: false, read: true };
  }

  private async validateScanAnchor(
    operation: X402OperationRecord,
    scan: AuthorizationUsedScan,
    rpcOrigin: string,
  ): Promise<{ readonly operation: X402OperationRecord; readonly reorg: boolean; readonly malformed: boolean }> {
    let targetBlock;
    try { targetBlock = await this.rpc.getX402Block(scan.targetSafeHead.number); }
    catch { return { operation, reorg: false, malformed: true }; }
    if (targetBlock.number !== scan.targetSafeHead.number || !sameRpcOrigin(targetBlock.rpcOrigin, rpcOrigin)) {
      return { operation, reorg: false, malformed: true };
    }
    if (targetBlock.hash !== scan.targetSafeHead.hash) return await this.resetScanAfterReorg(operation, scan, rpcOrigin);
    if (scan.lastCompletedChunk === undefined) return { operation, reorg: false, malformed: false };
    let priorEnd;
    try { priorEnd = await this.rpc.getX402Block(scan.lastCompletedChunk.toBlock); }
    catch { return { operation, reorg: false, malformed: true }; }
    if (
      priorEnd.number !== scan.lastCompletedChunk.toBlock || priorEnd.hash !== scan.lastCompletedChunk.toBlockHash ||
      !sameRpcOrigin(priorEnd.rpcOrigin, rpcOrigin)
    ) return await this.resetScanAfterReorg(operation, scan, rpcOrigin);
    return { operation, reorg: false, malformed: false };
  }

  private async resetScanAfterReorg(
    operation: X402OperationRecord,
    scan: AuthorizationUsedScan,
    rpcOrigin: string,
  ): Promise<{ readonly operation: X402OperationRecord; readonly reorg: boolean; readonly malformed: boolean }> {
    let currentSafe: X402RpcHead;
    try { currentSafe = await this.rpc.getX402Head("safe"); }
    catch { return { operation, reorg: false, malformed: true }; }
    if (
      !validX402Head(currentSafe) || !sameRpcOrigin(currentSafe.rpcOrigin, rpcOrigin) ||
      BigInt(currentSafe.number) < BigInt(scan.searchStartBlock)
    ) return { operation, reorg: false, malformed: true };
    const state = operation.state === "authorized_not_sent" && operation.attempts.length === 0 ? undefined : "effect_unknown";
    const reset = resetScan(scan.searchStartBlock, currentSafe, this.clock.now().toISOString());
    return {
      operation: await this.persist(operation, { authorizationUsedScan: reset }, state, true),
      reorg: true,
      malformed: false,
    };
  }
}

export function isCompleteZeroScan(scan: AuthorizationUsedScan | undefined): boolean {
  return scan?.status === "complete" && scan.candidates.length === 0 &&
    BigInt(scan.nextFromBlock) === BigInt(scan.targetSafeHead.number) + 1n;
}

export function scanCoversObservedSafe(scan: AuthorizationUsedScan | undefined, safe: X402RpcHead): boolean {
  return scan?.targetSafeHead.number === safe.number && scan.targetSafeHead.hash === safe.hash;
}

export function removeLogDerivedEvidence(
  operation: Omit<X402OperationRecord, "integrityHash">,
): Omit<X402OperationRecord, "integrityHash" | "transactionHint" | "settlementEvidence"> {
  const { transactionHint: _transactionHint, settlementEvidence: _settlementEvidence, ...withoutLogEvidence } = operation;
  return withoutLogEvidence;
}

export function sameRpcOrigin(left: string, right: string): boolean { return left === right; }

export function validX402Head(head: X402RpcHead): boolean {
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(head.number) || !/^(?:0|[1-9][0-9]*)$/u.test(head.timestamp) ||
    !/^0x[0-9a-f]{64}$/u.test(head.hash) || /^0x0{64}$/u.test(head.hash) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(head.observedAt)
  ) return false;
  const observedAt = Date.parse(head.observedAt);
  if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== head.observedAt) return false;
  return BigInt(head.timestamp) <= BigInt(Math.floor(observedAt / 1000));
}

export function candidateFromLog(log: X402RpcLog, operation: X402OperationRecord): AuthorizationUsedCandidate {
  return {
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    authorizer: operation.wallet,
    nonce: operation.authorization.nonce,
  };
}

export function matchingAuthorizationUsed(log: X402RpcLog, operation: X402OperationRecord): boolean {
  return log.address.toLowerCase() === BASE_USDC.toLowerCase() && log.topics.length === 3 &&
    log.topics[0]?.toLowerCase() === AUTHORIZATION_USED_TOPIC && log.topics[1]?.toLowerCase() === paddedAddress(operation.wallet) &&
    log.topics[2]?.toLowerCase() === operation.authorization.nonce && log.data === "0x";
}

export function matchingTransfer(log: X402RpcLog, operation: X402OperationRecord): boolean {
  if (
    log.address.toLowerCase() !== BASE_USDC.toLowerCase() || log.topics.length !== 3 ||
    log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics[1]?.toLowerCase() !== paddedAddress(operation.wallet) ||
    log.topics[2]?.toLowerCase() !== paddedAddress(operation.payee) || !/^0x[0-9a-f]{64}$/u.test(log.data)
  ) return false;
  return BigInt(log.data) === BigInt(operation.amountAtomic);
}

function sealScan(value: Omit<AuthorizationUsedScan, "evidenceHash">): AuthorizationUsedScan {
  return { ...value, evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(value)) };
}

function withoutEvidenceHash(scan: AuthorizationUsedScan): Omit<AuthorizationUsedScan, "evidenceHash"> {
  const { evidenceHash: _evidenceHash, unavailableReason: _unavailableReason, ...body } = scan;
  return body;
}

function resetScan(searchStartBlock: string, safe: X402RpcHead, updatedAt: string): AuthorizationUsedScan {
  return sealScan({
    schemaVersion: "apn.x402.authorization-used-scan.v1",
    searchStartBlock,
    nextFromBlock: searchStartBlock,
    targetSafeHead: { number: safe.number, hash: safe.hash, observedAt: safe.observedAt },
    candidates: [],
    status: "active",
    updatedAt,
  });
}

function candidateKey(candidate: AuthorizationUsedCandidate): string {
  return `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`;
}

function paddedAddress(address: `0x${string}`): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function unchanged(operation: X402OperationRecord): X402ScanOutcome {
  return { operation, reorg: false, unavailable: false, malformed: false, read: false };
}

function malformed(operation: X402OperationRecord, read: boolean): X402ScanOutcome {
  return { operation, reorg: false, unavailable: false, malformed: true, read };
}
