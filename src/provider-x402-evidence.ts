import { canonicalJson, hashObject, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address } from "./model.js";
import type { RpcPort, X402RpcBlock, X402RpcLog, X402RpcPort } from "./ports.js";
import type { ProviderX402OperationRecord, ProviderX402SettlementEvidence } from "./provider-x402-model.js";

export type ProviderSettlementObservation =
  | { readonly kind: "pending" }
  | { readonly kind: "ambiguous"; readonly reason: string; readonly upperBlock?: X402RpcBlock }
  | { readonly kind: "verified"; readonly upperBlock: X402RpcBlock; readonly evidence: ProviderX402SettlementEvidence };

export function providerX402ReadPort(rpc: RpcPort): X402RpcPort {
  const value = rpc as Partial<X402RpcPort>;
  if (
    typeof value.getX402Head !== "function" || typeof value.getX402Block !== "function" ||
    typeof value.getX402Receipt !== "function" || typeof value.getX402TransferLogs !== "function"
  ) throw new ApnError("APN_RPC_CONFIG", "Provider x402 requires the bounded read-only Base evidence surface.");
  return value as X402RpcPort;
}

export async function captureProviderEvidenceLowerBlock(rpc: X402RpcPort): Promise<{
  readonly lowerBlock: Awaited<ReturnType<X402RpcPort["getX402Head"]>>;
  readonly rpcOriginHash: string;
}> {
  const identity = await rpc.assertBaseChain();
  if (identity.chainId !== 8453 || identity.rpcOrigin.length === 0) throw protocol();
  const lowerBlock = await rpc.getX402Head("safe");
  assertHead(lowerBlock, identity.rpcOrigin);
  return { lowerBlock, rpcOriginHash: sha256(identity.rpcOrigin) };
}

export async function observeProviderSettlement(
  operation: ProviderX402OperationRecord,
  rpc: X402RpcPort,
): Promise<ProviderSettlementObservation> {
  if (operation.evidenceLowerBlock === undefined || operation.evidenceDeadlineAt === undefined) {
    return { kind: "ambiguous", reason: "provider_evidence_capability_gap" };
  }
  try {
    const identity = await rpc.assertBaseChain();
    if (sha256(identity.rpcOrigin) !== operation.rpcOriginHash) throw protocol();
    const safe = await rpc.getX402Head("safe");
    assertHead(safe, identity.rpcOrigin);
    const deadlineSeconds = BigInt(Math.ceil(Date.parse(operation.evidenceDeadlineAt) / 1_000));
    if (BigInt(safe.timestamp) < deadlineSeconds) return { kind: "pending" };
    const upperBlock = await immutableUpper(operation, rpc, safe.number, deadlineSeconds, identity.rpcOrigin);
    const logs = await outgoingTransfers(
      rpc,
      operation.provider.payer,
      operation.evidenceLowerBlock.number,
      upperBlock.number,
    );
    if (logs === null) return { kind: "ambiguous", reason: "provider_evidence_capability_gap", upperBlock };
    if (logs.length !== 1) return { kind: "ambiguous", reason: "settlement_not_unique", upperBlock };
    const transfer = logs[0];
    if (transfer === undefined || !matchesFrozenTransfer(transfer, operation)) {
      return { kind: "ambiguous", reason: "settlement_mismatch", upperBlock };
    }
    const receipt = await rpc.getX402Receipt(transfer.transactionHash);
    if (receipt === null) return { kind: "ambiguous", reason: "settlement_receipt_missing", upperBlock };
    if (
      receipt.status !== "success" || receipt.transactionHash !== transfer.transactionHash ||
      receipt.blockNumber !== transfer.blockNumber || receipt.blockHash !== transfer.blockHash ||
      receipt.rpcOrigin !== identity.rpcOrigin ||
      !receipt.logs.some((log) => canonicalJson(log) === canonicalJson(transfer))
    ) return { kind: "ambiguous", reason: "settlement_receipt_mismatch", upperBlock };
    const transactionBlock = await rpc.getX402Block(receipt.blockNumber);
    assertBlock(transactionBlock, identity.rpcOrigin);
    if (transactionBlock.hash !== receipt.blockHash) {
      return { kind: "ambiguous", reason: "settlement_block_mismatch", upperBlock };
    }
    const base = {
      schemaVersion: "apn.provider-x402.settlement.v1" as const,
      lowerBlock: operation.evidenceLowerBlock,
      upperBlock,
      transactionHash: transfer.transactionHash,
      receiptStatus: "success" as const,
      transfer,
      chainId: "8453" as const,
      network: CHAIN_CAIP2,
      token: BASE_USDC.toLowerCase() as `0x${string}`,
      payer: operation.provider.payer,
      payee: operation.requirement.payee,
      amountAtomic: operation.requirement.amountAtomic,
      rpcOriginHash: operation.rpcOriginHash,
    };
    return { kind: "verified", upperBlock, evidence: { ...base, evidenceHash: hashObject(base) } };
  } catch {
    return { kind: "ambiguous", reason: "provider_evidence_capability_gap" };
  }
}

async function immutableUpper(
  operation: ProviderX402OperationRecord,
  rpc: X402RpcPort,
  safeNumber: string,
  deadline: bigint,
  rpcOrigin: string,
): Promise<X402RpcBlock> {
  if (operation.immutableUpperBlock !== undefined) {
    const observed = await rpc.getX402Block(operation.immutableUpperBlock.number);
    assertBlock(observed, rpcOrigin);
    if (observed.hash !== operation.immutableUpperBlock.hash || observed.timestamp !== operation.immutableUpperBlock.timestamp) throw protocol();
    return operation.immutableUpperBlock;
  }
  let low = BigInt(operation.evidenceLowerBlock?.number ?? "0");
  let high = BigInt(safeNumber);
  if (low >= high) throw protocol();
  const lower = await rpc.getX402Block(low.toString());
  assertBlock(lower, rpcOrigin);
  const frozenLower = operation.evidenceLowerBlock;
  if (
    frozenLower === undefined || lower.number !== frozenLower.number || lower.hash !== frozenLower.hash ||
    lower.timestamp !== frozenLower.timestamp
  ) throw protocol();
  if (BigInt(lower.timestamp) >= deadline) throw protocol();
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    const block = await rpc.getX402Block(middle.toString());
    assertBlock(block, rpcOrigin);
    if (BigInt(block.timestamp) >= deadline) high = middle;
    else low = middle;
  }
  const upper = await rpc.getX402Block(high.toString());
  assertBlock(upper, rpcOrigin);
  if (BigInt(upper.timestamp) < deadline) throw protocol();
  return upper;
}

async function outgoingTransfers(
  rpc: X402RpcPort,
  payer: Address,
  start: string,
  end: string,
): Promise<readonly X402RpcLog[] | null> {
  const output: X402RpcLog[] = [];
  let from = BigInt(start);
  const to = BigInt(end);
  while (from <= to) {
    const chunkEnd = from + 2047n < to ? from + 2047n : to;
    const response = await rpc.getX402TransferLogs({ from: payer, fromBlock: from.toString(), toBlock: chunkEnd.toString() });
    if (response.kind !== "complete") return null;
    output.push(...response.logs);
    if (output.length > 256) throw protocol();
    from = chunkEnd + 1n;
  }
  return output;
}

function matchesFrozenTransfer(log: X402RpcLog, operation: ProviderX402OperationRecord): boolean {
  if (
    log.address !== BASE_USDC.toLowerCase() || log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC ||
    log.data.length !== 66 || log.topics[1] !== addressTopic(operation.provider.payer) ||
    log.topics[2] !== addressTopic(operation.requirement.payee)
  ) return false;
  try { return BigInt(log.data) === BigInt(operation.requirement.amountAtomic); }
  catch { return false; }
}

function addressTopic(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function assertHead(head: Awaited<ReturnType<X402RpcPort["getX402Head"]>>, rpcOrigin: string): void {
  if (head.queriedTag !== "safe" || head.rpcOrigin !== rpcOrigin) throw protocol();
  assertIdentity(head.number, head.hash, head.timestamp, head.observedAt);
}

function assertBlock(block: X402RpcBlock, rpcOrigin: string): void {
  if (block.queriedTag !== "number" || block.rpcOrigin !== rpcOrigin) throw protocol();
  assertIdentity(block.number, block.hash, block.timestamp, block.observedAt);
}

function assertIdentity(number: string, hash: string, timestamp: string, observedAt: string): void {
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(number) || !/^0x[0-9a-f]{64}$/u.test(hash) || /^0x0{64}$/u.test(hash) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(timestamp) || !Number.isFinite(Date.parse(observedAt)) ||
    BigInt(timestamp) > BigInt(Math.floor(Date.parse(observedAt) / 1_000))
  ) throw protocol();
}

function protocol(): ApnError { return new ApnError("APN_RPC_PROTOCOL", "Provider x402 Base evidence is invalid."); }
