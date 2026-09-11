import { createExactExecutionBatchTerms, createLimitedCallsTerms, hashDelegation } from "@metamask/delegation-core";
import { TypedDataEncoder } from "ethers";
import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { hashObject, sha256 } from "../../../src/canonical.js";
import { mmWalletIdentityHash } from "../../../src/metamask-gasless/identity.js";
import type { MetaMaskGaslessIntent, MetaMaskGaslessMutable, MetaMaskGaslessUnsignedDelegation } from
  "../../../src/metamask-gasless/model.js";
import { mmRequestHash, type MetaMaskGaslessOperationRecord } from "../../../src/metamask-gasless/operation-model.js";
import { mmRegistry } from "../../../src/metamask-gasless/registry.js";
import { mmFailure } from "../../../src/metamask-gasless/reasons.js";
import { MM_ANY_BENEFICIARY, MM_BATCH_MODE, MM_ROOT_AUTHORITY } from "../../../src/metamask-gasless/unsigned.js";
import { advanceMetaMaskGaslessOperation, newMetaMaskGaslessOperation } from
  "../../../src/metamask-gasless/journal/transitions.js";
import type { Address, Hex } from "../../../src/model.js";

export const OWNER = "0x1111111111111111111111111111111111111111" as Address;
export const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
export const FEE_RECIPIENT = "0x3333333333333333333333333333333333333333" as Address;
export const OUTER = "0x4444444444444444444444444444444444444444" as Address;
export const TX_HASH = `0x${"99".repeat(32)}` as Hex;
export const TX_HASH_B = `0x${"88".repeat(32)}` as Hex;
export const PREPARED = "2026-09-09T00:00:00.000Z";
export const APPROVED = "2026-09-09T00:00:30.000Z";
export const DISPATCHED = "2026-09-09T00:01:00.000Z";
export const EXPIRES = "2026-09-09T00:05:00.000Z";
const EMPTY_CODE_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);

function block(numberAtomic: string, byte: string) {
  return { numberAtomic, hash: `0x${byte.repeat(64)}` as Hex, timestampAtomic: "1788900000" };
}

export function makeIntent(profile = "fixture", designation: "empty" | "pinned" = "empty"): MetaMaskGaslessIntent {
  const registry = mmRegistry(8453), row = registry.row;
  const profileHash = sha256(`profile\0${profile}`);
  const binding = { providerId: "metamask-agent-wallet" as const, address: OWNER,
    accountBindingHash: hashObject({ fixture: "account" }), capabilityHash: hashObject({ fixture: "capability" }),
    revision: 1, projectHash: hashObject({ fixture: "project" }),
    walletReferenceHash: hashObject({ fixture: "reference" }), walletIdHash: mmWalletIdentityHash(OWNER),
    namespace: "eip155" as const, mode: "server" as const, environment: "prod" as const };
  const request = { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic: "10000000",
    maxFeeAtomic: "50000", minReceivedAtomic: "9950000" };
  const executions = [
    { target: row.token, value: "0", callData: encodeFunctionData({ abi: transferAbi,
      functionName: "transfer", args: [RECIPIENT, 9_950_000n] }) },
    { target: row.token, value: "0", callData: encodeFunctionData({ abi: transferAbi,
      functionName: "transfer", args: [FEE_RECIPIENT, 50_000n] }) },
  ] as const;
  const quoteMaterial = { netAtomic: "9950000", feeAtomic: "50000", feeRecipient: FEE_RECIPIENT, executions };
  const quote = { ...quoteMaterial, hash: hashObject(quoteMaterial) };
  const delegation: MetaMaskGaslessUnsignedDelegation = { delegator: OWNER, delegate: MM_ANY_BENEFICIARY,
    authority: MM_ROOT_AUTHORITY, salt: `0x${"42".repeat(32)}` as Hex,
    caveats: [{ enforcer: row.protocol.limitedCalls.address, terms: createLimitedCallsTerms({ limit: 1 }), args: "0x" },
      { enforcer: row.protocol.exactBatch.address, terms: createExactExecutionBatchTerms({
        executions: executions.map(execution => ({ ...execution, value: BigInt(execution.value) })),
      }), args: "0x" }] };
  const official = { ...delegation, salt: BigInt(delegation.salt), caveats: [...delegation.caveats], signature: "0x" as Hex };
  const types = { Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
    Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" },
      { name: "salt", type: "uint256" }] };
  const unsigned = { unsignedDelegation: delegation, delegationHash: hashDelegation(official),
    signingDigest: TypedDataEncoder.hash({ name: "DelegationManager", version: "1", chainId: 8453,
      verifyingContract: row.protocol.manager.address }, types, official) as Hex,
    relayTo: row.protocol.manager.address, mode: MM_BATCH_MODE };
  const state = { protocolCodeHashes: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
    [name, pin.codeHash])) as MetaMaskGaslessIntent["initialSnapshot"]["safeState"]["protocolCodeHashes"],
    tokenProxyCodeHash: row.tokenProxyCodeHash, tokenImplementationAddress: row.tokenImplementationAddress,
    tokenImplementationCodeHash: row.tokenImplementationCodeHash, tokenDecimals: 6 as const,
    ownerCodeHash: (designation === "pinned" ? keccak256(`0xef0100${row.protocol.delegate.address.slice(2)}`) :
      EMPTY_CODE_HASH) as Hex, designation, usdcBalanceAtomic: "50000000", counterAtomic: "0" };
  const initialSnapshot = { chainId: 8453 as const, endpointHash: sha256("https://rpc.example/rpc?synthetic=1"),
    endpointOrigin: "https://rpc.example", observedAt: PREPARED, safeBlock: block("100", "a"),
    headBlock: block("102", "b"), safeState: state, headState: state };
  const policyHash = hashObject({ purpose: "apn.metamask-gasless.policy.v1", profileHash, binding,
    chainId: 8453, token: row.token, recipient: RECIPIENT, grossAtomic: request.grossAtomic,
    maxFeeAtomic: request.maxFeeAtomic, minReceivedAtomic: request.minReceivedAtomic });
  return { profile, request, binding, token: row.token, decimals: 6, deploymentEvidenceHash: registry.deploymentEvidenceHash,
    initialSnapshot, quote, requestId: "12345678-1234-4234-8234-123456789abc", ...unsigned,
    preparedAt: PREPARED, expiresAt: EXPIRES, policyHash };
}

export function makeOperation(profile = "fixture", idempotencyKey = "key-1",
  operationId?: string, designation: "empty" | "pinned" = "empty"): MetaMaskGaslessOperationRecord {
  const intent = makeIntent(profile, designation), profileHash = sha256(`profile\0${profile}`);
  return newMetaMaskGaslessOperation({ profileHash,
    operationId: operationId ?? sha256(`operation\0${profile}\0${idempotencyKey}`),
    idempotencyHash: sha256(`idempotency\0${idempotencyKey}`), requestHash: mmRequestHash(profileHash, intent) }, intent);
}

export function approve(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessOperationRecord {
  return advanceMetaMaskGaslessOperation(operation, { state: "execution_pending",
    approval: { fingerprint: operation.fingerprint, approvedAt: APPROVED, expiresAt: EXPIRES } }, APPROVED);
}

export function mark(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessOperationRecord {
  return advanceMetaMaskGaslessOperation(operation, { state: "dispatch_pending", submissionAttempts: 1,
    dispatchStartedAt: DISPATCHED }, DISPATCHED);
}

export function unknown(operation: MetaMaskGaslessOperationRecord, at = "2026-09-09T00:02:00.000Z") {
  return advanceMetaMaskGaslessOperation(operation, { state: "unknown_finality",
    providerObservation: { observedAt: at, requestIdHash: hashObject({
      purpose: "apn.metamask-gasless.request-id.v1", value: operation.intent.requestId }), status: "unavailable", txHash: null },
    observation: { observedAt: at, phase: "unavailable", reason: "mm_gasless_rpc_unavailable",
      candidateTxHash: null, transactionBlock: null, finalityBlock: null, evidenceHash: null },
    failure: mmFailure("mm_gasless_submit_unknown") }, at);
}

export function complete(operation: MetaMaskGaslessOperationRecord, at = "2026-09-09T00:10:00.000Z",
  txHash: Hex = TX_HASH) {
  const transactionBlock = block("120", "c"), finalityBlock = block("150", "d"), row = mmRegistry(8453).row;
  const protocolCodeHashes = Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) => [name, pin.codeHash]));
  const tokenState = { address: row.tokenImplementationAddress, codeHash: row.tokenImplementationCodeHash,
    proxyCodeHash: row.tokenProxyCodeHash };
  const settlement = { observedAt: at, txHash, transactionBlock, finalityBlock, outerSender: OUTER,
    transactionProofHash: hashObject({ fixture: "transaction" }), receiptHash: hashObject({ fixture: "receipt" }),
    protocolHash: hashObject({ deploymentEvidenceHash: mmRegistry(8453).deploymentEvidenceHash,
      receipt: { block: transactionBlock, code: protocolCodeHashes },
      finality: { block: finalityBlock, code: protocolCodeHashes } }),
    tokenImplementationHash: hashObject({ token: row.token, receipt: { block: transactionBlock, ...tokenState },
      finality: { block: finalityBlock, ...tokenState } }),
    deliveredAtomic: "9950000", feeAtomic: "50000", debitAtomic: "10000000", refundAtomic: "0" as const,
    unusedGrossAtomic: "0" as const, designation: "pinned" as const, permission: "consumed" as const,
    receiptCounterAtomic: "1" as const, finalityCounterAtomic: "1" as const };
  const patch: Partial<MetaMaskGaslessMutable> = { state: "completed", providerObservation: { observedAt: at,
    requestIdHash: hashObject({ purpose: "apn.metamask-gasless.request-id.v1", value: operation.intent.requestId }),
    status: "confirmed", txHash }, cursor: { startBlock: operation.cursor.startBlock,
    nextBlockAtomic: "151", previousEndBlock: finalityBlock }, observation: { observedAt: at, phase: "success",
    reason: "mm_gasless_success", candidateTxHash: txHash, transactionBlock, finalityBlock,
    evidenceHash: hashObject({ fixture: "evidence" }) }, settlement, failure: null };
  return advanceMetaMaskGaslessOperation(operation, patch, at);
}
